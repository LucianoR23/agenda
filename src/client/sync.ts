"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { uuidv7 } from "uuidv7";
import { ApiProblem, api } from "./api";
import { idb, type Optimistic, type OutboxItem } from "./db";

// ---------- status store ----------

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  conflicts: OutboxItem[];
  lastSync: number | null;
}

let state: SyncState = { online: true, syncing: false, pending: 0, conflicts: [], lastSync: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const SERVER_STATE: SyncState = { online: true, syncing: false, pending: 0, conflicts: [], lastSync: null };

export const useSync = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER_STATE,
  );

export function markSynced() {
  const now = Date.now();
  set({ lastSync: now });
  try {
    localStorage.setItem("agenda:lastSync", String(now));
  } catch {}
}

async function refreshCounts() {
  const all = await idb().outbox.orderBy("createdAt").toArray();
  set({ pending: all.filter((i) => i.state === "pending").length, conflicts: all.filter((i) => i.state === "conflict") });
}

// ---------- optimistic edits ----------

/** Applies one optimistic change to whatever is in the query cache. No kinds yet (see `Optimistic`). */
function applyOne(_qc: QueryClient, _o: Optimistic) {}

/** Queued (not yet sent) edits applied to freshly fetched data, so a refetch never "undoes" them. */
export async function withPending<T>(_key: unknown[], data: T): Promise<T> {
  return data;
}

/** Re-applies queued edits to what is already in the query cache (after hydrating from IndexedDB). */
export async function reapplyPending(qc: QueryClient) {
  const items = await idb().outbox.orderBy("createdAt").toArray();
  for (const i of items) if (i.optimistic && i.state === "pending") applyOne(qc, i.optimistic);
}

// ---------- outbox ----------

let flushing: Promise<void> | null = null;

export async function enqueue(qc: QueryClient, item: Omit<OutboxItem, "id" | "createdAt" | "state">) {
  const full: OutboxItem = { ...item, id: uuidv7(), createdAt: Date.now(), state: "pending" };
  if (item.optimistic) applyOne(qc, item.optimistic);
  await idb().outbox.add(full);
  await refreshCounts();
  void flush(qc);
  return full.id;
}

/** Sends queued writes in order. Network failure stops the run (retried on reconnect); 409 parks the item as a conflict. */
export function flush(qc: QueryClient): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    set({ syncing: true });
    try {
      const items = await idb().outbox.where("state").equals("pending").sortBy("createdAt");
      for (const item of items) {
        try {
          await api(item.method, item.path, item.body, { "Idempotency-Key": item.id });
          await idb().outbox.delete(item.id);
          for (const k of item.invalidate) await qc.invalidateQueries({ queryKey: JSON.parse(k) });
          markSynced();
        } catch (e) {
          if (!(e instanceof ApiProblem)) throw e;
          if (e.offline) {
            set({ online: false });
            break;
          }
          if (e.problem.status === 409 || e.problem.status === 412) {
            await idb().outbox.update(item.id, {
              state: "conflict",
              conflict: { code: e.problem.code, detail: e.problem.message, current: e.problem.details?.current },
            });
          } else {
            // rejected for good (validation, gone…): drop it and show the server's truth
            await idb().outbox.delete(item.id);
            for (const k of item.invalidate) await qc.invalidateQueries({ queryKey: JSON.parse(k) });
            notifyRejected(item, REASON[e.problem.code ?? ""] ?? e.problem.message);
          }
        }
      }
    } finally {
      set({ syncing: false });
      await refreshCounts();
      flushing = null;
    }
  })();
  return flushing;
}

/** Conflict sheet: keep mine (re-send against the server's current version) or take the server's. */
export async function resolveConflict(qc: QueryClient, id: string, choice: "mine" | "server") {
  const item = await idb().outbox.get(id);
  if (!item) return;
  if (choice === "server") {
    await idb().outbox.delete(id);
    for (const k of item.invalidate) await qc.invalidateQueries({ queryKey: JSON.parse(k) });
  } else {
    const current = item.conflict?.current as { version?: number } | undefined;
    const body =
      item.body && typeof item.body === "object" && current?.version ? { ...(item.body as object), version: current.version } : item.body;
    // a fresh key: the old one is bound to the rejected request
    const { conflict: _resolved, ...rest } = item;
    const fresh: OutboxItem = { ...rest, body, id: uuidv7(), state: "pending" };
    await idb().outbox.delete(id);
    await idb().outbox.add(fresh);
    void flush(qc);
  }
  await refreshCounts();
}

/** Friendly copy for rejection codes (filled per entity as they arrive). */
const REASON: Record<string, string> = {};

type RejectListener = (item: OutboxItem, reason: string) => void;
const rejectListeners = new Set<RejectListener>();
export const onRejected = (l: RejectListener) => {
  rejectListeners.add(l);
  return () => void rejectListeners.delete(l);
};
const notifyRejected = (item: OutboxItem, reason: string) => {
  for (const l of rejectListeners) l(item, reason);
};

/** Wires connectivity events and a periodic retry. Call once on the client. */
export function startSync(qc: QueryClient) {
  try {
    const last = localStorage.getItem("agenda:lastSync");
    if (last) set({ lastSync: Number(last) });
  } catch {}
  set({ online: navigator.onLine });
  window.addEventListener("online", () => {
    set({ online: true });
    void flush(qc);
    void qc.invalidateQueries();
  });
  window.addEventListener("offline", () => set({ online: false }));
  const timer = setInterval(() => void flush(qc), 15_000);
  void refreshCounts().then(() => flush(qc));
  return () => clearInterval(timer);
}

export const setOnline = (online: boolean) => set({ online });

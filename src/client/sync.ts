"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { uuidv7 } from "uuidv7";
import { api, ApiProblem } from "./api";
import { idb, type Optimistic, type OutboxItem } from "./db";
import type { Day, Task } from "./types";

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
  listeners.forEach((l) => l());
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

function patchDayBlock(day: Day, blockId: string, patch: Record<string, unknown>): Day {
  return {
    ...day,
    options: day.options.map((o) => ({
      ...o,
      blocks: o.blocks.map((b) =>
        b.id !== blockId
          ? b
          : {
              ...b,
              ...patch,
              ...("status" in patch ? { statusAt: patch.status === "pending" ? null : new Date().toISOString() } : {}),
              version: b.version + 1,
            },
      ),
    })),
  } as Day;
}

const patchTask = (t: Task, taskId: string, patch: Record<string, unknown>): Task =>
  t.id !== taskId ? t : ({ ...t, ...patch, ...("done" in patch ? { doneAt: patch.done ? new Date().toISOString() : null } : {}), version: t.version + 1 } as Task);

/** Applies one optimistic change to whatever is in the query cache. */
function applyOne(qc: QueryClient, o: Optimistic) {
  if (o.kind === "block") qc.setQueryData<Day>(["day", o.date], (d) => (d ? patchDayBlock(d, o.blockId, o.patch) : d));
  if (o.kind === "task") {
    qc.setQueryData<Day>(["day", o.date], (d) => (d ? { ...d, tasks: d.tasks.map((t) => patchTask(t, o.taskId, o.patch)) } : d));
    qc.setQueryData<{ tasks: Task[] }>(["tasks", o.date], (r) => (r ? { tasks: r.tasks.map((t) => patchTask(t, o.taskId, o.patch)) } : r));
  }
}

/** Queued (not yet sent) edits applied to freshly fetched data, so a refetch never "undoes" them. */
export async function withPending<T>(key: unknown[], data: T): Promise<T> {
  const items = (await idb().outbox.orderBy("createdAt").toArray()).filter((i) => i.state === "pending" && i.optimistic);
  let out: unknown = data;
  for (const { optimistic: o } of items) {
    if (!o || key[1] !== o.date) continue;
    if (key[0] === "day") out = o.kind === "block" ? patchDayBlock(out as Day, o.blockId, o.patch) : { ...(out as Day), tasks: (out as Day).tasks.map((t) => patchTask(t, o.taskId, o.patch)) };
    if (key[0] === "tasks" && o.kind === "task") out = { tasks: (out as { tasks: Task[] }).tasks.map((t) => patchTask(t, o.taskId, o.patch)) };
  }
  return out as T;
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
            await idb().outbox.update(item.id, { state: "conflict", conflict: { code: e.problem.code, detail: e.problem.detail, current: e.problem.current } });
          } else {
            // rejected for good (validation, gone…): drop it and show the server's truth
            await idb().outbox.delete(item.id);
            for (const k of item.invalidate) await qc.invalidateQueries({ queryKey: JSON.parse(k) });
            notifyRejected(item, e.problem.detail ?? e.problem.title);
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
    const body = item.body && typeof item.body === "object" && current?.version ? { ...(item.body as object), version: current.version } : item.body;
    // a fresh key: the old one is bound to the rejected request
    const fresh = { ...item, body, id: uuidv7(), state: "pending" as const, conflict: undefined };
    await idb().outbox.delete(id);
    await idb().outbox.add(fresh);
    void flush(qc);
  }
  await refreshCounts();
}

type RejectListener = (item: OutboxItem, reason: string) => void;
const rejectListeners = new Set<RejectListener>();
export const onRejected = (l: RejectListener) => {
  rejectListeners.add(l);
  return () => void rejectListeners.delete(l);
};
const notifyRejected = (item: OutboxItem, reason: string) => rejectListeners.forEach((l) => l(item, reason));

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

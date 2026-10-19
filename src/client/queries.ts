"use client";

import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiProblem, get } from "./api";
import { idb } from "./db";
import { enqueue, markSynced, reapplyPending, setOnline, withPending } from "./sync";
import type { Day, DaySummary, Device, HabitProgress, Metrics, SessionState, Task, WebhookStatus } from "./types";

const CACHE_DAYS = 14;

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 7 * 86_400_000,
        retry: (count, err) => !(err instanceof ApiProblem && (err.offline || err.problem.status < 500)) && count < 2,
        networkMode: "always",
        refetchOnWindowFocus: true,
      },
    },
  });
}

/** IndexedDB first: puts every cached response into the query cache before the first render. */
export async function hydrateFromIdb(qc: QueryClient) {
  const cutoff = Date.now() - CACHE_DAYS * 86_400_000;
  await idb().cache.where("at").below(cutoff).delete();
  // shown immediately, but marked stale so every screen revalidates against the server on mount
  for (const e of await idb().cache.toArray()) qc.setQueryData(JSON.parse(e.key), e.data, { updatedAt: 1 });
  await reapplyPending(qc);
}

/** Network first with IndexedDB fallback; successful reads are cached for offline use. */
async function cached<T>(key: unknown[], path: string): Promise<T> {
  const k = JSON.stringify(key);
  try {
    const data = await get<T>(path);
    setOnline(true);
    markSynced();
    void idb().cache.put({ key: k, data, at: Date.now() });
    return withPending(key, data);
  } catch (e) {
    if (e instanceof ApiProblem && e.offline) {
      setOnline(false);
      const hit = await idb().cache.get(k);
      if (hit) return withPending(key, hit.data as T);
    }
    throw e;
  }
}

function useCached<T>(key: unknown[], path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T, ApiProblem>({ queryKey: key, queryFn: () => cached<T>(key, path!), enabled: path !== null, ...opts });
}

export const useDay = (date: string) => useCached<Day>(["day", date], `/api/days/${date}`, { refetchInterval: 60_000 });
export const useDays = (from: string, to: string) => useCached<{ days: DaySummary[] }>(["days", from, to], `/api/days?from=${from}&to=${to}`);
export const useHabits = () => useCached<{ habits: HabitProgress[] }>(["habits"], "/api/habits");
export const useTasks = (date: string) => useCached<{ tasks: Task[] }>(["tasks", date], `/api/tasks?date=${date}`);
export const useMetrics = (range: string, anchor: string) => useCached<Metrics>(["metrics", range, anchor], `/api/metrics?range=${range}&anchor=${anchor}`);
export const useDevices = () => useCached<{ devices: Device[] }>(["devices"], "/api/auth/devices");
export const useWebhookStatus = () => useCached<WebhookStatus>(["webhook"], "/api/webhook/status");

export const useSession = () =>
  useQuery<SessionState, ApiProblem>({ queryKey: ["session"], queryFn: () => get<SessionState>("/api/auth/session"), staleTime: 60_000, retry: 1 });

// ---------- writes ----------

const k = (...key: unknown[]) => JSON.stringify(key);

/** Writes go through the outbox: optimistic, queued with an Idempotency-Key, replayed when back online. */
export function useWrites(date: string) {
  const qc = useQueryClient();
  const dayKeys = [k("day", date), k("tasks", date), k("habits")];
  // the version the edit was made against travels with it: if the server moved on, it answers 409 → conflict sheet
  const blockVersion = (id: string) =>
    qc
      .getQueryData<Day>(["day", date])
      ?.options.flatMap((o) => o.blocks)
      .find((b) => b.id === id)?.version;
  const taskVersion = (id: string) => qc.getQueryData<Day>(["day", date])?.tasks.find((t) => t.id === id)?.version ?? qc.getQueryData<{ tasks: Task[] }>(["tasks", date])?.tasks.find((t) => t.id === id)?.version;
  return {
    patchBlock: (blockId: string, patch: Record<string, unknown>, label = "Bloque actualizado") =>
      enqueue(qc, {
        method: "PATCH",
        path: `/api/days/${date}/blocks/${blockId}`,
        body: { ...patch, ...(blockVersion(blockId) ? { version: blockVersion(blockId) } : {}) },
        invalidate: dayKeys,
        optimistic: { kind: "block", date, blockId, patch },
        label,
      }),
    patchTask: (taskId: string, patch: Record<string, unknown>) =>
      enqueue(qc, {
        method: "PATCH",
        path: `/api/tasks/${taskId}`,
        body: { ...patch, ...(taskVersion(taskId) ? { version: taskVersion(taskId) } : {}) },
        invalidate: dayKeys,
        optimistic: { kind: "task", date, taskId, patch },
        label: "Tarea",
      }),
    send: (method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, label: string, extra: string[] = []) =>
      enqueue(qc, { method, path, body, invalidate: [...dayKeys, ...extra], label }),
  };
}

/** Direct (online-only) call that refreshes the given queries; used for auth/settings screens. */
export function useDirect() {
  const qc = useQueryClient();
  return async <T = unknown>(method: string, path: string, body?: unknown, refresh: unknown[][] = []) => {
    const r = await api<T>(method, path, body);
    for (const key of refresh) await qc.invalidateQueries({ queryKey: key });
    return r.data;
  };
}

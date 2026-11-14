"use client";

import { QueryClient, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiProblem, api, get } from "./api";
import { idb } from "./db";
import { markSynced, reapplyPending, setOnline, withPending } from "./sync";
import type { ApiToken, Device, SessionState, Settings, Task, TaskList, TaskQuery } from "./types";

const CACHE_DAYS = 14;
/** Bump when an API response changes shape: entries cached by older builds are dropped instead of rendered. */
const CACHE_VERSION = 3;

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
  await idb()
    .cache.filter((e) => e.at < cutoff || e.v !== CACHE_VERSION)
    .delete();
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
    void idb().cache.put({ key: k, data, at: Date.now(), v: CACHE_VERSION });
    return withPending(key, data);
  } catch (e) {
    if (e instanceof ApiProblem && e.offline) {
      setOnline(false);
      const hit = await idb().cache.get(k);
      if (hit?.v === CACHE_VERSION) return withPending(key, hit.data as T);
    }
    throw e;
  }
}

function useCached<T>(key: unknown[], path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T, ApiProblem>({ queryKey: key, queryFn: path === null ? skipToken : () => cached<T>(key, path), ...opts });
}

export const useDevices = () => useCached<{ devices: Device[] }>(["devices"], "/api/auth/devices");
export const useTokens = () => useCached<{ tokens: ApiToken[] }>(["tokens"], "/api/tokens");
export const useSettings = () => useCached<Settings>(["settings"], "/api/settings");
export const useTaskLists = () => useCached<{ lists: TaskList[] }>(["lists"], "/api/lists");

/** Tasks for a view/filter; the query object is part of the cache key (and drives optimistic updates). */
export function useTasks(query: TaskQuery) {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
  return useCached<{ tasks: Task[] }>(["tasks", query], `/api/tasks?${params}`);
}

export const useSession = () =>
  useQuery<SessionState, ApiProblem>({
    queryKey: ["session"],
    queryFn: () => get<SessionState>("/api/auth/session"),
    staleTime: 60_000,
    retry: 1,
  });

// ---------- writes ----------

/** Direct (online-only) call that refreshes the given queries; used for auth/settings screens. */
export function useDirect() {
  const qc = useQueryClient();
  return async <T = unknown>(method: string, path: string, body?: unknown, refresh: unknown[][] = []) => {
    const r = await api<T>(method, path, body);
    for (const key of refresh) await qc.invalidateQueries({ queryKey: key });
    return r.data;
  };
}

/** In-memory sliding window (single container, D26). */
const windows = new Map<string, number[]>();

export const AGENT_LIMIT_PER_MINUTE = 120;

/** Returns null when allowed, or seconds to wait. */
export function hit(key: string, limit: number, nowMs: number): number | null {
  const since = nowMs - 60_000;
  const list = (windows.get(key) ?? []).filter((t) => t > since);
  if (list.length >= limit) {
    windows.set(key, list);
    return Math.max(1, Math.ceil((list[0] - since) / 1000));
  }
  list.push(nowMs);
  windows.set(key, list);
  return null;
}

/** Tests only. */
export const resetRateLimits = () => windows.clear();

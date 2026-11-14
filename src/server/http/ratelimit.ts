import { ApiError } from "./errors";

/** In-memory sliding windows (single container; a restart starts them over). */
const windows = new Map<string, number[]>();

/** Returns null when allowed (and counts the hit), or seconds to wait. */
export function hit(key: string, limit: number, nowMs: number, windowMs = 60_000): number | null {
  const since = nowMs - windowMs;
  const list = (windows.get(key) ?? []).filter((t) => t > since);
  const oldest = list[0];
  if (list.length >= limit && oldest !== undefined) {
    windows.set(key, list);
    return Math.max(1, Math.ceil((oldest - since) / 1000));
  }
  list.push(nowMs);
  windows.set(key, list);
  return null;
}

/** Per API token (docs/v2/04): 60 requests a minute and 1,000 a day. */
export const TOKEN_LIMITS = { perMinute: 60, perDay: 1000 };

export function limitToken(tokenId: string, nowMs: number) {
  const minute = hit(`token:${tokenId}:min`, TOKEN_LIMITS.perMinute, nowMs);
  const wait = minute ?? hit(`token:${tokenId}:day`, TOKEN_LIMITS.perDay, nowMs, 86_400_000);
  if (wait === null) return;
  throw new ApiError(
    429,
    "RATE_LIMITED",
    minute !== null
      ? `Demasiados pedidos seguidos (máximo ${TOKEN_LIMITS.perMinute} por minuto). Esperá ${wait} segundos y reintentá.`
      : `Se alcanzó el límite de ${TOKEN_LIMITS.perDay} pedidos por día para este token. Probá más tarde.`,
    { retryAfterSeconds: wait },
    { "Retry-After": String(wait) },
  );
}

/** Tests only. */
export const resetRateLimits = () => windows.clear();

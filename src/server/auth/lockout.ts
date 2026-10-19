import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { authAttempt, authLockout } from "../db/schema";
import type { Ctx } from "../http/context";
import { ApiError } from "../http/errors";

export const MAX_FAILURES = 5;
const BASE_MS = 15 * 60_000;
const CAP_MS = 24 * 3_600_000;

type Method = typeof authAttempt.$inferInsert.method;

const keys = (ctx: Ctx) => [
  { scope: "device" as const, key: ctx.sessionDevice?.id ?? ctx.deviceKey ?? "unknown" },
  { scope: "global" as const, key: "global" },
];

/** 15 min × 2^(n−1), capped at 24 h. */
export const lockDuration = (lockoutCount: number) => Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, lockoutCount - 1));

/** Throws 429 locked_out if the device or the whole app is locked. */
export async function assertNotLocked(ctx: Ctx) {
  for (const k of keys(ctx)) {
    const [row] = await getDb().select().from(authLockout).where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
    if (row?.lockedUntil && row.lockedUntil > ctx.now) {
      const wait = Math.ceil((row.lockedUntil.getTime() - ctx.now.getTime()) / 1000);
      throw new ApiError(429, "locked_out", `Try again in ${Math.ceil(wait / 60)} minutes.`, { retryAfterSeconds: wait }, { "Retry-After": String(wait) });
    }
  }
}

/**
 * Records a failed credential check on the pool (outside the request transaction, so it survives the rollback)
 * and throws 401 invalid_credentials, or 429 locked_out when this failure triggers a lockout.
 */
export async function failAttempt(ctx: Ctx, method: Method, detail: string): Promise<never> {
  const db = getDb();
  await db.insert(authAttempt).values({ method, success: false, deviceKey: ctx.deviceKey || null, deviceId: ctx.sessionDevice?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent, at: ctx.now });
  let remaining = MAX_FAILURES;
  let lockedUntil: Date | null = null;
  for (const k of keys(ctx)) {
    const [row] = await db
      .insert(authLockout)
      .values({ ...k, failedCount: 1, lastFailedAt: ctx.now })
      .onConflictDoUpdate({
        target: [authLockout.scope, authLockout.key],
        set: { failedCount: sql`${authLockout.failedCount} + 1`, lastFailedAt: ctx.now },
      })
      .returning();
    if (row.failedCount >= MAX_FAILURES) {
      const count = row.lockoutCount + 1;
      const until = new Date(ctx.now.getTime() + lockDuration(count));
      await db.update(authLockout).set({ failedCount: 0, lockoutCount: count, lockedUntil: until }).where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
      if (!lockedUntil || until > lockedUntil) lockedUntil = until;
    } else remaining = Math.min(remaining, MAX_FAILURES - row.failedCount);
  }
  if (lockedUntil) {
    const wait = Math.ceil((lockedUntil.getTime() - ctx.now.getTime()) / 1000);
    throw new ApiError(429, "locked_out", `Try again in ${Math.ceil(wait / 60)} minutes.`, { retryAfterSeconds: wait }, { "Retry-After": String(wait) });
  }
  throw new ApiError(401, "invalid_credentials", detail, { remainingAttempts: remaining });
}

/** Success resets both counters (and the doubling). Runs inside the request transaction (the device may be new). */
export async function succeedAttempt(ctx: Ctx, method: Method, deviceId: string | null) {
  const db = ctx.db;
  await db.insert(authAttempt).values({ method, success: true, deviceKey: ctx.deviceKey || null, deviceId, ip: ctx.ip, userAgent: ctx.userAgent, at: ctx.now });
  for (const k of [...keys(ctx), ...(deviceId ? [{ scope: "device" as const, key: deviceId }] : [])])
    await db.update(authLockout).set({ failedCount: 0, lockoutCount: 0, lockedUntil: null }).where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
}

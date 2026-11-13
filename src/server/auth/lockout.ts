import { and, count, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { one } from "../db/one";
import { auditEvent, authAttempt, authLockout } from "../db/schema";
import { fromDate, toDate } from "../domain/time";
import type { Ctx } from "../http/context";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { sendNotice } from "../push";
import { audit } from "./audit";

/**
 * Brute-force protection (docs/v2/07):
 * - **device** (session device or pre-auth device-key cookie) and **ip**: 5 failures → locked for 15 min × 2^(n−1),
 *   capped at 24 h. A stranger's guesses lock their own browser/IP, never Lemy's phone.
 * - **global**: never locks anyone (v1's global lock let an attacker lock Lemy out). Many failures across the
 *   internet only slow every credential check down a little and send Lemy a push, at most once an hour.
 */
export const MAX_FAILURES = 5;
const BASE_MINUTES = 15;
const CAP_MINUTES = 24 * 60;
/** Failures in the last hour (any source) from which checks get slower and Lemy gets an alert. */
export const GLOBAL_ALERT_THRESHOLD = 20;
/** Extra wait per failed check while over the threshold (tests lower it). */
export const tuning = { globalDelayMs: 1000 };

type Method = typeof authAttempt.$inferInsert.method;
type Key = { scope: "device" | "ip"; key: string };

/** Lockout keys for this request: the device (or pre-auth key) and the client IP when known. */
function keys(ctx: Ctx): Key[] {
  const out: Key[] = [{ scope: "device", key: ctx.sessionDevice?.id ?? (ctx.deviceKey || "unknown") }];
  if (ctx.ip) out.push({ scope: "ip", key: ctx.ip });
  return out;
}

/** Minutes locked after the n-th lockout: 15, 30, 60 … capped at 24 h. */
export const lockMinutes = (lockoutCount: number) => Math.min(CAP_MINUTES, BASE_MINUTES * 2 ** Math.max(0, lockoutCount - 1));

const lockedOut = (ctx: Ctx, until: Temporal.Instant) => {
  const wait = Math.max(1, Math.ceil(ctx.now.until(until).total("seconds")));
  const minutes = Math.ceil(wait / 60);
  return new ApiError(
    429,
    "LOCKED_OUT",
    `Demasiados intentos fallidos. Probá de nuevo en ${minutes} min, o usá un código de recuperación desde otro dispositivo.`,
    { retryAfterSeconds: wait },
    { "Retry-After": String(wait) },
  );
};

/** Throws 429 LOCKED_OUT while this device or IP is locked. */
export async function assertNotLocked(ctx: Ctx) {
  for (const k of keys(ctx)) {
    const [row] = await getDb()
      .select()
      .from(authLockout)
      .where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
    if (row?.lockedUntil) {
      const until = fromDate(row.lockedUntil);
      if (Temporal.Instant.compare(until, ctx.now) > 0) throw lockedOut(ctx, until);
    }
  }
}

/** Seconds left on this device's/IP's lock, or null (for the session state shown on the unlock screen). */
export async function lockedUntil(ctx: Ctx): Promise<Temporal.Instant | null> {
  try {
    await assertNotLocked(ctx);
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.code === "LOCKED_OUT") return ctx.now.add({ seconds: Number(e.details?.retryAfterSeconds ?? 0) });
    throw e;
  }
}

const recentFailures = async (ctx: Ctx) => {
  const since = toDate(ctx.now.subtract({ hours: 1 }));
  const [row] = await getDb()
    .select({ n: count() })
    .from(authAttempt)
    .where(and(eq(authAttempt.success, false), gte(authAttempt.at, since)));
  return row?.n ?? 0;
};

/** Over the global threshold: slow down and alert Lemy (once an hour). Never a lock. */
async function globalPressure(ctx: Ctx) {
  const failures = await recentFailures(ctx);
  if (failures < GLOBAL_ALERT_THRESHOLD) return;
  const db = getDb();
  const since = toDate(ctx.now.subtract({ hours: 1 }));
  const [alerted] = await db
    .select({ n: count() })
    .from(auditEvent)
    .where(and(eq(auditEvent.kind, "failed_attempts_alert"), gte(auditEvent.at, since)));
  if (!alerted?.n) {
    await audit(ctx, "failed_attempts_alert", { failuresLastHour: failures }, db);
    await sendNotice(db, {
      title: "Intentos de acceso fallidos",
      body: `${failures} intentos fallidos en la última hora. Si no fuiste vos, revisá Ajustes → Seguridad.`,
      url: "/ajustes/seguridad",
    }).catch((err) => log.error("failed attempts alert", { err }));
  }
  await new Promise((r) => setTimeout(r, tuning.globalDelayMs));
}

/**
 * Records a failed credential check on the pool (outside the request transaction, so it survives the rollback)
 * and throws 401 INVALID_CREDENTIALS, or 429 LOCKED_OUT when this failure locks the device or IP.
 */
export async function failAttempt(ctx: Ctx, method: Method, message: string): Promise<never> {
  const db = getDb();
  const at = toDate(ctx.now);
  await db.insert(authAttempt).values({
    method,
    success: false,
    deviceKey: ctx.deviceKey || null,
    deviceId: ctx.sessionDevice?.id ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    at,
  });
  let remaining = MAX_FAILURES;
  let until: Temporal.Instant | null = null;
  for (const k of keys(ctx)) {
    const row = one(
      await db
        .insert(authLockout)
        .values({ ...k, failedCount: 1, lastFailedAt: at })
        .onConflictDoUpdate({
          target: [authLockout.scope, authLockout.key],
          set: { failedCount: sql`${authLockout.failedCount} + 1`, lastFailedAt: at },
        })
        .returning(),
      "lockout upsert",
    );
    if (row.failedCount >= MAX_FAILURES) {
      const n = row.lockoutCount + 1;
      const lockEnd = ctx.now.add({ minutes: lockMinutes(n) });
      await db
        .update(authLockout)
        .set({ failedCount: 0, lockoutCount: n, lockedUntil: toDate(lockEnd) })
        .where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
      await audit(ctx, "lockout", { scope: k.scope, method, minutes: lockMinutes(n) }, db);
      if (!until || Temporal.Instant.compare(lockEnd, until) > 0) until = lockEnd;
    } else remaining = Math.min(remaining, MAX_FAILURES - row.failedCount);
  }
  await globalPressure(ctx);
  if (until) throw lockedOut(ctx, until);
  throw new ApiError(401, "INVALID_CREDENTIALS", `${message} Te quedan ${remaining} intentos.`, { remainingAttempts: remaining });
}

/** Success clears this device's (and pre-auth key's) and this IP's counters. Runs inside the request transaction. */
export async function succeedAttempt(ctx: Ctx, method: Method, deviceId: string | null) {
  await ctx.db.insert(authAttempt).values({
    method,
    success: true,
    deviceKey: ctx.deviceKey || null,
    deviceId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    at: toDate(ctx.now),
  });
  const clear = [...keys(ctx), ...(deviceId ? [{ scope: "device" as const, key: deviceId }] : [])];
  if (ctx.deviceKey) clear.push({ scope: "device", key: ctx.deviceKey });
  for (const k of clear)
    await ctx.db
      .update(authLockout)
      .set({ failedCount: 0, lockoutCount: 0, lockedUntil: null })
      .where(and(eq(authLockout.scope, k.scope), eq(authLockout.key, k.key)));
}

import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { idempotencyKey } from "../db/schema";
import { fromDate, toDate } from "../domain/time";
import { ApiError } from "./errors";

/** 24 h (docs/v2/02). */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

/** Who called: `session` (the app) or `token:<id>` (an API token, phase 3). Keys never collide across callers. */
export type IdempotencyScope = string;

export type Reservation = { replay: { status: number; body: unknown } } | { reserved: true } | null;

/**
 * Reserves an Idempotency-Key before running the handler (autocommit, outside the request transaction):
 * same key + same request → replay the stored response; different request → 422; still running → 409.
 */
export async function reserve(
  db: DbLike,
  scope: IdempotencyScope,
  key: string,
  method: string,
  path: string,
  rawBody: string,
  now: Temporal.Instant,
): Promise<Reservation> {
  const requestHash = createHash("sha256").update(`${method} ${path}\n${rawBody}`).digest("hex");
  const inserted = await db
    .insert(idempotencyKey)
    .values({ scope, key, method, path, requestHash, createdAt: toDate(now) })
    .onConflictDoNothing()
    .returning({ key: idempotencyKey.key });
  if (inserted.length) return { reserved: true };

  const [row] = await db
    .select()
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.scope, scope), eq(idempotencyKey.key, key)));
  if (!row) return reserve(db, scope, key, method, path, rawBody, now);
  if (fromDate(row.createdAt).until(now).total("milliseconds") > IDEMPOTENCY_TTL_MS) {
    await release(db, scope, key);
    return reserve(db, scope, key, method, path, rawBody, now);
  }
  if (row.requestHash !== requestHash) throw new ApiError(422, "IDEMPOTENCY_KEY_REUSE");
  if (row.responseStatus === null) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS");
  return { replay: { status: row.responseStatus, body: row.responseBody === null ? undefined : JSON.parse(row.responseBody) } };
}

export async function complete(db: DbLike, scope: IdempotencyScope, key: string, status: number, body: unknown) {
  await db
    .update(idempotencyKey)
    .set({ responseStatus: status, responseBody: body === undefined || body === null ? null : JSON.stringify(body) })
    .where(and(eq(idempotencyKey.scope, scope), eq(idempotencyKey.key, key)));
}

export async function release(db: DbLike, scope: IdempotencyScope, key: string) {
  await db.delete(idempotencyKey).where(and(eq(idempotencyKey.scope, scope), eq(idempotencyKey.key, key)));
}

export async function purgeExpired(db: DbLike, now: Temporal.Instant): Promise<number> {
  const rows = await db
    .delete(idempotencyKey)
    .where(lt(idempotencyKey.createdAt, toDate(now.subtract({ milliseconds: IDEMPOTENCY_TTL_MS }))))
    .returning({ key: idempotencyKey.key });
  return rows.length;
}

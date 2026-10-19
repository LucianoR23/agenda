import { and, eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { DbLike } from "../db/client";
import { idempotencyKey } from "../db/schema";
import type { Actor } from "./context";
import { ApiError } from "./errors";

export const IDEMPOTENCY_TTL_MS = 48 * 3_600_000;

export type Reservation = { replay: { status: number; body: unknown } } | { reserved: true } | null;

/**
 * Reserves an Idempotency-Key before running the handler (autocommit, outside the request transaction):
 * same key + same request → replay the stored response; different request → 422; still running → 409.
 */
export async function reserve(db: DbLike, actor: Actor, key: string, method: string, path: string, rawBody: string, now: Date): Promise<Reservation> {
  const requestHash = createHash("sha256").update(`${method} ${path}\n${rawBody}`).digest("hex");
  const inserted = await db
    .insert(idempotencyKey)
    .values({ key, actor, method, path, requestHash, createdAt: now })
    .onConflictDoNothing()
    .returning({ key: idempotencyKey.key });
  if (inserted.length) return { reserved: true };

  const [row] = await db
    .select()
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.actor, actor), eq(idempotencyKey.key, key)));
  if (!row) return reserve(db, actor, key, method, path, rawBody, now);
  if (now.getTime() - row.createdAt.getTime() > IDEMPOTENCY_TTL_MS) {
    await release(db, actor, key);
    return reserve(db, actor, key, method, path, rawBody, now);
  }
  if (row.requestHash !== requestHash)
    throw new ApiError(422, "idempotency_key_reuse", "This Idempotency-Key was used with a different request.");
  if (row.responseStatus === null)
    throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still in progress.");
  return { replay: { status: row.responseStatus, body: row.responseBody === null ? undefined : JSON.parse(row.responseBody) } };
}

export async function complete(db: DbLike, actor: Actor, key: string, status: number, body: unknown) {
  await db
    .update(idempotencyKey)
    .set({ responseStatus: status, responseBody: body === undefined || body === null ? null : JSON.stringify(body) })
    .where(and(eq(idempotencyKey.actor, actor), eq(idempotencyKey.key, key)));
}

export async function release(db: DbLike, actor: Actor, key: string) {
  await db.delete(idempotencyKey).where(and(eq(idempotencyKey.actor, actor), eq(idempotencyKey.key, key)));
}

export async function purgeExpired(db: DbLike, now: Date): Promise<number> {
  const rows = await db
    .delete(idempotencyKey)
    .where(lt(idempotencyKey.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)))
    .returning({ key: idempotencyKey.key });
  return rows.length;
}

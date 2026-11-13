import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { one } from "../db/one";
import { apiToken, type TokenScope } from "../db/schema";
import { formatInstant, fromDate, toDate } from "../domain/time";
import { type Ctx, requireDevice } from "../http/context";
import { ApiError, notFound } from "../http/errors";
import { audit } from "./audit";
import { randomToken, sha256 } from "./crypto";
import { recentlyUnlocked } from "./session";

/**
 * Named API tokens (Sunday). Secret format `agd_<32 random bytes base64url>`, shown once; the database keeps
 * only its SHA-256 and the first 8 characters for display.
 */
export const TOKEN_PREFIX = "agd_";
const TOKEN_RE = /^agd_[A-Za-z0-9_-]{43}$/;

type Row = typeof apiToken.$inferSelect;

export function tokenOut(t: Row, tz: string) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.tokenPrefix,
    scopes: t.scopes,
    lastUsedAt: t.lastUsedAt ? formatInstant(t.lastUsedAt, tz) : null,
    lastUsedIp: t.lastUsedIp,
    expiresAt: t.expiresAt ? formatInstant(t.expiresAt, tz) : null,
    createdAt: formatInstant(t.createdAt, tz),
  };
}

/** Creating or revoking a token needs PIN or fingerprint confirmed on this device in the last 5 minutes. */
function requireRecentAuth(ctx: Ctx) {
  if (!recentlyUnlocked(requireDevice(ctx), ctx.now)) throw new ApiError(403, "REAUTH_REQUIRED");
}

export async function listTokens(ctx: Ctx) {
  const rows = await ctx.db.select().from(apiToken).where(isNull(apiToken.revokedAt)).orderBy(desc(apiToken.createdAt));
  return rows.map((t) => tokenOut(t, ctx.tz));
}

export async function createToken(ctx: Ctx, body: { name: string; scopes: TokenScope[]; expiresAt?: string }) {
  requireRecentAuth(ctx);
  const name = body.name.trim();
  const [taken] = await ctx.db
    .select({ id: apiToken.id })
    .from(apiToken)
    .where(and(eq(apiToken.name, name), isNull(apiToken.revokedAt)));
  if (taken) throw new ApiError(409, "CONFLICT", `Ya hay un token activo llamado "${name}". Revocalo o elegí otro nombre.`);
  const expiresAt = body.expiresAt ? Temporal.Instant.from(body.expiresAt) : null;
  if (expiresAt && Temporal.Instant.compare(expiresAt, ctx.now) <= 0)
    throw new ApiError(400, "VALIDATION_ERROR", "La fecha de vencimiento tiene que ser futura.", {
      fields: [{ path: "/expiresAt", message: "Must be in the future" }],
    });
  const secret = `${TOKEN_PREFIX}${randomToken(32)}`;
  const row = one(
    await ctx.db
      .insert(apiToken)
      .values({
        name,
        tokenPrefix: secret.slice(0, 8),
        tokenHash: sha256(secret),
        scopes: [...new Set(body.scopes)],
        expiresAt: expiresAt ? toDate(expiresAt) : null,
      })
      .returning(),
    "token insert",
  );
  await audit(ctx, "token_created", { tokenId: row.id, name, scopes: row.scopes });
  // the secret is in this response only; it can't be recovered later
  return { ...tokenOut(row, ctx.tz), token: secret };
}

export async function revokeToken(ctx: Ctx, id: string) {
  requireRecentAuth(ctx);
  const [row] = await ctx.db
    .update(apiToken)
    .set({ revokedAt: toDate(ctx.now) })
    .where(and(eq(apiToken.id, id), isNull(apiToken.revokedAt)))
    .returning();
  if (!row) throw notFound("No encontré ese token (o ya estaba revocado).");
  await audit(ctx, "token_revoked", { tokenId: row.id, name: row.name });
}

/**
 * Resolves a bearer secret to an active token, or null. `last_used_at`/`last_used_ip` are written at most once a
 * minute.
 */
export async function authenticateToken(db: DbLike, secret: string, now: Temporal.Instant, ip: string | null) {
  if (!TOKEN_RE.test(secret)) return null;
  const [row] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.tokenHash, sha256(secret)), isNull(apiToken.revokedAt)));
  if (!row) return null;
  if (row.expiresAt && Temporal.Instant.compare(fromDate(row.expiresAt), now) <= 0) return null;
  if (!row.lastUsedAt || fromDate(row.lastUsedAt).until(now).total("seconds") >= 60)
    await db
      .update(apiToken)
      .set({ lastUsedAt: toDate(now), lastUsedIp: ip })
      .where(eq(apiToken.id, row.id));
  return row;
}

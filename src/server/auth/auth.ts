import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { DbLike } from "../db/client";
import { appUser, device, passkey, pinResetCode, pushSubscription, recoveryCode } from "../db/schema";
import { env } from "../env";
import type { Ctx } from "../http/context";
import { ApiError, notFound } from "../http/errors";
import { isoLocal } from "../time";
import type { DeviceRow } from "../domain/rows";
import { CHALLENGE_COOKIE, clearCookie, parseCookies, SESSION_COOKIE, setCookie } from "./cookies";
import { hashSecret, normalizeRecoveryCode, recoveryCode as newRecoveryCode, sign, unsign, verifySecret } from "./crypto";
import { assertNotLocked, failAttempt, succeedAttempt } from "./lockout";
import { createDevice, deviceNameFromUA, issueSession } from "./session";

async function getUser(db: DbLike) {
  const [u] = await db.select().from(appUser).limit(1);
  return u ?? null;
}

async function requireUser(ctx: Ctx) {
  const u = await getUser(ctx.db);
  if (!u) throw new ApiError(404, "not_found", "Setup required.");
  return u;
}

export async function deviceOut(db: DbLike, d: DeviceRow, currentId: string | null) {
  const [pk] = await db.select({ id: passkey.id }).from(passkey).where(eq(passkey.deviceId, d.id));
  return {
    id: d.id,
    name: d.name,
    userAgent: d.userAgent,
    current: d.id === currentId,
    passkeyEnabled: !!pk,
    createdAt: isoLocal(d.createdAt),
    lastSeenAt: isoLocal(d.lastSeenAt),
    lastUnlockAt: isoLocal(d.lastUnlockAt),
  };
}

async function newRecoveryCodes(db: DbLike) {
  await db.delete(recoveryCode);
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  for (const c of codes) await db.insert(recoveryCode).values({ hash: await hashSecret(c) });
  return codes;
}

/** Trusts this browser: re-uses its device when the cookie is known (even locked), else creates one. */
async function trustDevice(ctx: Ctx, name?: string) {
  if (ctx.sessionDevice) {
    ctx.setCookies.push(await issueSession(ctx.db, ctx.sessionDevice.id, ctx.now));
    const [d] = await ctx.db.select().from(device).where(eq(device.id, ctx.sessionDevice.id));
    return d;
  }
  const { device: d, cookie } = await createDevice(ctx.db, name ?? deviceNameFromUA(ctx.userAgent), ctx.userAgent, ctx.now);
  ctx.setCookies.push(cookie);
  return d;
}

export async function sessionState(ctx: Ctx) {
  const user = await getUser(ctx.db);
  const d = ctx.sessionDevice;
  const [pk] = d ? await ctx.db.select({ id: passkey.id }).from(passkey).where(eq(passkey.deviceId, d.id)) : [];
  let lockedUntil: string | null = null;
  try {
    await assertNotLocked(ctx);
  } catch (e) {
    if (e instanceof ApiError && e.code === "locked_out") lockedUntil = isoLocal(new Date(ctx.now.getTime() + (e.extra.retryAfterSeconds ?? 0) * 1000));
  }
  return {
    state: !user ? ("setup_required" as const) : !d ? ("unauthenticated" as const) : ctx.sessionLocked ? ("locked" as const) : ("unlocked" as const),
    passkeyEnabled: !!pk,
    lockedUntil,
    device: d ? { id: d.id, name: d.name } : null,
  };
}

export async function setup(ctx: Ctx, body: { setupCode: string; pin: string; deviceName?: string }) {
  if (await getUser(ctx.db)) throw new ApiError(404, "setup_completed", "Setup was already completed.");
  await assertNotLocked(ctx);
  const a = Buffer.from(body.setupCode);
  const b = Buffer.from(env().SETUP_CODE);
  if (a.length !== b.length || !a.equals(b)) await failAttempt(ctx, "setup", "Wrong setup code.");
  await ctx.db.insert(appUser).values({ pinHash: await hashSecret(body.pin), webauthnUserId: new Uint8Array(randomBytes(16)) });
  const codes = await newRecoveryCodes(ctx.db);
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, "setup", d.id);
  return { device: await deviceOut(ctx.db, d, d.id), recoveryCodes: codes };
}

export async function unlock(ctx: Ctx, body: { pin: string; deviceName?: string }) {
  const user = await requireUser(ctx);
  await assertNotLocked(ctx);
  if (!(await verifySecret(user.pinHash, body.pin))) await failAttempt(ctx, "pin", "Wrong PIN.");
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, "pin", d.id);
  return { device: await deviceOut(ctx.db, d, d.id) };
}

export async function recover(ctx: Ctx, body: { method: "recovery_code" | "reset_code"; code: string; newPin: string; deviceName?: string }) {
  await requireUser(ctx);
  await assertNotLocked(ctx);
  if (body.method === "recovery_code") {
    const code = normalizeRecoveryCode(body.code);
    const unused = await ctx.db.select().from(recoveryCode).where(isNull(recoveryCode.usedAt));
    let hit: (typeof unused)[number] | undefined;
    for (const r of unused) if (await verifySecret(r.hash, code)) hit = r;
    if (!hit) return failAttempt(ctx, "recovery_code", "Invalid or used recovery code.");
    await ctx.db.update(recoveryCode).set({ usedAt: ctx.now }).where(eq(recoveryCode.id, hit.id));
  } else {
    const valid = await ctx.db
      .select()
      .from(pinResetCode)
      .where(and(isNull(pinResetCode.usedAt), gt(pinResetCode.expiresAt, ctx.now)))
      .orderBy(desc(pinResetCode.createdAt));
    let hit: (typeof valid)[number] | undefined;
    for (const r of valid) if (await verifySecret(r.hash, body.code.trim())) hit = r;
    if (!hit) return failAttempt(ctx, "reset_code", "Invalid or expired reset code.");
    await ctx.db.update(pinResetCode).set({ usedAt: ctx.now }).where(eq(pinResetCode.id, hit.id));
  }
  await ctx.db.update(appUser).set({ pinHash: await hashSecret(body.newPin), pinUpdatedAt: ctx.now });
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, body.method, d.id);
  const remaining = (await ctx.db.select({ id: recoveryCode.id }).from(recoveryCode).where(isNull(recoveryCode.usedAt))).length;
  return { device: await deviceOut(ctx.db, d, d.id), remainingRecoveryCodes: remaining };
}

async function checkPin(ctx: Ctx, pin: string) {
  const user = await requireUser(ctx);
  await assertNotLocked(ctx);
  if (!(await verifySecret(user.pinHash, pin))) await failAttempt(ctx, "pin", "Wrong PIN.");
  await succeedAttempt(ctx, "pin", ctx.sessionDevice?.id ?? null);
}

export async function changePin(ctx: Ctx, body: { currentPin: string; newPin: string }) {
  await checkPin(ctx, body.currentPin);
  await ctx.db.update(appUser).set({ pinHash: await hashSecret(body.newPin), pinUpdatedAt: ctx.now });
}

export async function regenerateRecoveryCodes(ctx: Ctx, pin: string) {
  await checkPin(ctx, pin);
  return { recoveryCodes: await newRecoveryCodes(ctx.db) };
}

// ---------- passkeys (fingerprint) ----------

const CHALLENGE_TTL_MS = 5 * 60_000;

function storeChallenge(ctx: Ctx, purpose: "register" | "auth", challenge: string) {
  ctx.setCookies.push(setCookie(CHALLENGE_COOKIE, sign({ purpose, challenge, exp: ctx.now.getTime() + CHALLENGE_TTL_MS }, env().SESSION_SECRET), 300));
}

function takeChallenge(ctx: Ctx, purpose: "register" | "auth"): string {
  const c = unsign<{ purpose: string; challenge: string; exp: number }>(parseCookies(ctx.req.headers.get("cookie"))[CHALLENGE_COOKIE], env().SESSION_SECRET);
  ctx.setCookies.push(clearCookie(CHALLENGE_COOKIE));
  if (!c || c.purpose !== purpose || c.exp < ctx.now.getTime()) throw new ApiError(401, "invalid_credentials", "Challenge expired; start again.");
  return c.challenge;
}

export async function passkeyRegisterOptions(ctx: Ctx) {
  const user = await requireUser(ctx);
  const existing = await ctx.db.select().from(passkey);
  const options = await generateRegistrationOptions({
    rpName: "Agenda",
    rpID: env().WEBAUTHN_RP_ID,
    userName: "agenda",
    userDisplayName: "Agenda",
    userID: new Uint8Array(user.webauthnUserId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
  });
  storeChallenge(ctx, "register", options.challenge);
  return options;
}

export async function passkeyRegisterVerify(ctx: Ctx, response: Record<string, unknown>) {
  const d = ctx.sessionDevice!;
  const expectedChallenge = takeChallenge(ctx, "register");
  const result = await verifyRegistrationResponse({
    response: response as unknown as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin: env().APP_ORIGIN,
    expectedRPID: env().WEBAUTHN_RP_ID,
    requireUserVerification: true,
  }).catch((e: Error) => {
    throw new ApiError(401, "invalid_credentials", e.message);
  });
  if (!result.verified) throw new ApiError(401, "invalid_credentials", "Passkey verification failed.");
  const c = result.registrationInfo.credential;
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, d.id));
  const [row] = await ctx.db
    .insert(passkey)
    .values({ deviceId: d.id, credentialId: c.id, publicKey: c.publicKey, counter: c.counter, transports: c.transports ?? [] })
    .returning();
  return { id: row.id, deviceId: row.deviceId, createdAt: isoLocal(row.createdAt), lastUsedAt: null };
}

async function devicePasskey(ctx: Ctx) {
  if (!ctx.sessionDevice) throw notFound("Passkey");
  const [pk] = await ctx.db.select().from(passkey).where(eq(passkey.deviceId, ctx.sessionDevice.id));
  if (!pk) throw notFound("Passkey");
  return pk;
}

export async function passkeyAuthOptions(ctx: Ctx) {
  const pk = await devicePasskey(ctx);
  await assertNotLocked(ctx);
  const options = await generateAuthenticationOptions({
    rpID: env().WEBAUTHN_RP_ID,
    allowCredentials: [{ id: pk.credentialId, transports: pk.transports }],
    userVerification: "required",
  });
  storeChallenge(ctx, "auth", options.challenge);
  return options;
}

export async function passkeyAuthVerify(ctx: Ctx, response: Record<string, unknown>) {
  const pk = await devicePasskey(ctx);
  await assertNotLocked(ctx);
  const expectedChallenge = takeChallenge(ctx, "auth");
  const result = await verifyAuthenticationResponse({
    response: response as unknown as AuthenticationResponseJSON,
    expectedChallenge,
    expectedOrigin: env().APP_ORIGIN,
    expectedRPID: env().WEBAUTHN_RP_ID,
    credential: { id: pk.credentialId, publicKey: new Uint8Array(pk.publicKey), counter: pk.counter, transports: pk.transports },
    requireUserVerification: true,
  }).catch(() => null);
  if (!result?.verified) return failAttempt(ctx, "passkey", "Fingerprint verification failed.");
  await ctx.db.update(passkey).set({ counter: result.authenticationInfo.newCounter, lastUsedAt: ctx.now }).where(eq(passkey.id, pk.id));
  const d = await trustDevice(ctx);
  await succeedAttempt(ctx, "passkey", d.id);
  return { device: await deviceOut(ctx.db, d, d.id) };
}

export async function deletePasskey(ctx: Ctx) {
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, ctx.sessionDevice!.id));
}

// ---------- devices ----------

export async function listDevices(ctx: Ctx) {
  const rows = await ctx.db.select().from(device).where(isNull(device.revokedAt)).orderBy(desc(device.lastSeenAt));
  return Promise.all(rows.map((d) => deviceOut(ctx.db, d, ctx.sessionDevice?.id ?? null)));
}

async function findDevice(ctx: Ctx, id: string) {
  const [d] = await ctx.db.select().from(device).where(and(eq(device.id, id), isNull(device.revokedAt)));
  if (!d) throw notFound("Device");
  return d;
}

export async function renameDevice(ctx: Ctx, id: string, name: string) {
  await findDevice(ctx, id);
  const [d] = await ctx.db.update(device).set({ name }).where(eq(device.id, id)).returning();
  return deviceOut(ctx.db, d, ctx.sessionDevice?.id ?? null);
}

export async function revokeDevice(ctx: Ctx, id: string) {
  await findDevice(ctx, id);
  await ctx.db.update(device).set({ revokedAt: ctx.now }).where(eq(device.id, id));
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, id));
  await ctx.db.delete(pushSubscription).where(eq(pushSubscription.deviceId, id));
  if (id === ctx.sessionDevice?.id) ctx.setCookies.push(clearCookie(SESSION_COOKIE));
}

// ---------- CLI ----------

/** `pnpm auth:reset-pin`: one-time 8-digit code valid 15 min. */
export async function createResetCode(db: DbLike, code: string, now: Date) {
  await db.insert(pinResetCode).values({ hash: await hashSecret(code), expiresAt: new Date(now.getTime() + 15 * 60_000) });
}

export { newRecoveryCodes };

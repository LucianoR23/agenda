import { randomBytes } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { one } from "../db/one";
import { appUser, device, passkey, pinResetCode, pushSubscription, recoveryCode } from "../db/schema";
import type { DeviceRow } from "../domain/rows";
import { resetSettingsCache } from "../domain/settings";
import { formatInstant, toDate } from "../domain/time";
import { env } from "../env";
import { type Ctx, requireDevice } from "../http/context";
import { ApiError, notFound } from "../http/errors";
import { audit } from "./audit";
import { CHALLENGE_COOKIE, clearCookie, parseCookies, SESSION_COOKIE, setCookie } from "./cookies";
import { digestEqual, hashSecret, recoveryCode as newRecoveryCode, normalizeRecoveryCode, sign, unsign, verifySecret } from "./crypto";
import { assertNotLocked, failAttempt, lockedUntil, succeedAttempt } from "./lockout";
import { createDevice, deviceNameFromUA, issueSession } from "./session";

async function getUser(db: DbLike) {
  const [u] = await db.select().from(appUser).limit(1);
  return u ?? null;
}

async function requireUser(ctx: Ctx) {
  const u = await getUser(ctx.db);
  if (!u) throw new ApiError(404, "SETUP_REQUIRED");
  return u;
}

export async function deviceOut(ctx: Ctx, d: DeviceRow) {
  const [pk] = await ctx.db.select({ id: passkey.id }).from(passkey).where(eq(passkey.deviceId, d.id));
  return {
    id: d.id,
    name: d.name,
    userAgent: d.userAgent,
    current: d.id === ctx.sessionDevice?.id,
    passkeyEnabled: !!pk,
    createdAt: formatInstant(d.createdAt, ctx.tz),
    lastSeenAt: formatInstant(d.lastSeenAt, ctx.tz),
    lastUnlockAt: formatInstant(d.lastUnlockAt, ctx.tz),
  };
}

/** Device output right after this request trusted it (it's now the current device). */
const trustedOut = async (ctx: Ctx, d: DeviceRow) => ({ ...(await deviceOut({ ...ctx, sessionDevice: d }, d)), current: true });

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
    return one(await ctx.db.select().from(device).where(eq(device.id, ctx.sessionDevice.id)), "trusted device");
  }
  const { device: d, cookie } = await createDevice(ctx.db, name ?? deviceNameFromUA(ctx.userAgent), ctx.userAgent, ctx.now);
  ctx.setCookies.push(cookie);
  return d;
}

export async function sessionState(ctx: Ctx) {
  const user = await getUser(ctx.db);
  const d = ctx.sessionDevice;
  const [pk] = d ? await ctx.db.select({ id: passkey.id }).from(passkey).where(eq(passkey.deviceId, d.id)) : [];
  const until = user ? await lockedUntil(ctx) : null;
  return {
    state: !user
      ? ("setup_required" as const)
      : !d
        ? ("unauthenticated" as const)
        : ctx.sessionLocked
          ? ("locked" as const)
          : ("unlocked" as const),
    passkeyEnabled: !!pk,
    lockedUntil: until ? formatInstant(until, ctx.tz) : null,
    device: d ? { id: d.id, name: d.name } : null,
    vapidPublicKey: env().VAPID_PUBLIC_KEY || null,
    timezone: ctx.tz,
  };
}

export async function setup(ctx: Ctx, body: { setupCode: string; pin: string; deviceName?: string }) {
  if (await getUser(ctx.db)) throw new ApiError(409, "SETUP_COMPLETED");
  await assertNotLocked(ctx);
  // constant time whatever the lengths (both sides hashed first)
  if (!digestEqual(body.setupCode, env().SETUP_CODE)) await failAttempt(ctx, "setup", "Código de configuración incorrecto.");
  await ctx.db.insert(appUser).values({ pinHash: await hashSecret(body.pin), webauthnUserId: new Uint8Array(randomBytes(16)) });
  resetSettingsCache();
  const codes = await newRecoveryCodes(ctx.db);
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, "setup", d.id);
  await audit({ ...ctx, sessionDevice: d }, "setup");
  return { device: await trustedOut(ctx, d), recoveryCodes: codes };
}

export async function unlock(ctx: Ctx, body: { pin: string; deviceName?: string }) {
  const user = await requireUser(ctx);
  await assertNotLocked(ctx);
  if (!(await verifySecret(user.pinHash, body.pin))) await failAttempt(ctx, "pin", "PIN incorrecto.");
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, "pin", d.id);
  await audit({ ...ctx, sessionDevice: d }, "unlock", { method: "pin" });
  return { device: await trustedOut(ctx, d) };
}

/** Confirms the PIN on an unlocked device (sensitive actions: API tokens). Refreshes the 5-minute window. */
export async function reauth(ctx: Ctx, pin: string) {
  const d = requireDevice(ctx);
  const user = await requireUser(ctx);
  await assertNotLocked(ctx);
  if (!(await verifySecret(user.pinHash, pin))) await failAttempt(ctx, "pin", "PIN incorrecto.");
  await succeedAttempt(ctx, "pin", d.id);
  await ctx.db
    .update(device)
    .set({ lastUnlockAt: toDate(ctx.now) })
    .where(eq(device.id, d.id));
  await audit(ctx, "reauth", { method: "pin" });
  return { validUntil: formatInstant(ctx.now.add({ minutes: 5 }), ctx.tz) };
}

export async function recover(
  ctx: Ctx,
  body: { method: "recovery_code" | "reset_code"; code: string; newPin: string; deviceName?: string },
) {
  await requireUser(ctx);
  await assertNotLocked(ctx);
  const now = toDate(ctx.now);
  if (body.method === "recovery_code") {
    const code = normalizeRecoveryCode(body.code);
    const unused = await ctx.db.select().from(recoveryCode).where(isNull(recoveryCode.usedAt));
    let hit: (typeof unused)[number] | undefined;
    for (const r of unused) if (await verifySecret(r.hash, code)) hit = r;
    if (!hit) return failAttempt(ctx, "recovery_code", "Código de recuperación inválido o ya usado.");
    await ctx.db.update(recoveryCode).set({ usedAt: now }).where(eq(recoveryCode.id, hit.id));
  } else {
    const valid = await ctx.db
      .select()
      .from(pinResetCode)
      .where(and(isNull(pinResetCode.usedAt), gt(pinResetCode.expiresAt, now)))
      .orderBy(desc(pinResetCode.createdAt));
    let hit: (typeof valid)[number] | undefined;
    for (const r of valid) if (await verifySecret(r.hash, body.code.trim())) hit = r;
    if (!hit) return failAttempt(ctx, "reset_code", "Código del servidor inválido o vencido.");
    await ctx.db.update(pinResetCode).set({ usedAt: now }).where(eq(pinResetCode.id, hit.id));
  }
  await ctx.db.update(appUser).set({ pinHash: await hashSecret(body.newPin), pinUpdatedAt: now });
  const d = await trustDevice(ctx, body.deviceName);
  await succeedAttempt(ctx, body.method, d.id);
  await audit({ ...ctx, sessionDevice: d }, "recover", { method: body.method });
  const remaining = (await ctx.db.select({ id: recoveryCode.id }).from(recoveryCode).where(isNull(recoveryCode.usedAt))).length;
  return { device: await trustedOut(ctx, d), remainingRecoveryCodes: remaining };
}

async function checkPin(ctx: Ctx, pin: string) {
  const user = await requireUser(ctx);
  await assertNotLocked(ctx);
  if (!(await verifySecret(user.pinHash, pin))) await failAttempt(ctx, "pin", "PIN incorrecto.");
  await succeedAttempt(ctx, "pin", ctx.sessionDevice?.id ?? null);
}

export async function changePin(ctx: Ctx, body: { currentPin: string; newPin: string }) {
  await checkPin(ctx, body.currentPin);
  await ctx.db.update(appUser).set({ pinHash: await hashSecret(body.newPin), pinUpdatedAt: toDate(ctx.now) });
  await audit(ctx, "pin_changed");
}

export async function regenerateRecoveryCodes(ctx: Ctx, pin: string) {
  await checkPin(ctx, pin);
  const codes = await newRecoveryCodes(ctx.db);
  await audit(ctx, "recovery_codes_regenerated");
  return { recoveryCodes: codes };
}

// ---------- passkeys (fingerprint) ----------

const CHALLENGE_TTL_MINUTES = 5;

function storeChallenge(ctx: Ctx, purpose: "register" | "auth", challenge: string) {
  const exp = ctx.now.add({ minutes: CHALLENGE_TTL_MINUTES }).epochMilliseconds;
  ctx.setCookies.push(setCookie(CHALLENGE_COOKIE, sign({ purpose, challenge, exp }, env().SESSION_SECRET), CHALLENGE_TTL_MINUTES * 60));
}

function takeChallenge(ctx: Ctx, purpose: "register" | "auth"): string {
  const c = unsign<{ purpose: string; challenge: string; exp: number }>(
    parseCookies(ctx.req.headers.get("cookie"))[CHALLENGE_COOKIE],
    env().SESSION_SECRET,
  );
  ctx.setCookies.push(clearCookie(CHALLENGE_COOKIE));
  if (!c || c.purpose !== purpose || c.exp < ctx.now.epochMilliseconds)
    throw new ApiError(401, "INVALID_CREDENTIALS", "El desafío de la huella venció. Probá de nuevo.");
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
  const d = requireDevice(ctx);
  const expectedChallenge = takeChallenge(ctx, "register");
  const result = await verifyRegistrationResponse({
    response: response as unknown as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin: env().APP_ORIGIN,
    expectedRPID: env().WEBAUTHN_RP_ID,
    requireUserVerification: true,
  }).catch(() => {
    throw new ApiError(401, "INVALID_CREDENTIALS", "No se pudo verificar la huella.");
  });
  if (!result.verified) throw new ApiError(401, "INVALID_CREDENTIALS", "No se pudo verificar la huella.");
  const c = result.registrationInfo.credential;
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, d.id));
  const row = one(
    await ctx.db
      .insert(passkey)
      .values({ deviceId: d.id, credentialId: c.id, publicKey: c.publicKey, counter: c.counter, transports: c.transports ?? [] })
      .returning(),
    "passkey insert",
  );
  await audit(ctx, "passkey_registered");
  return { id: row.id, deviceId: row.deviceId, createdAt: formatInstant(row.createdAt, ctx.tz), lastUsedAt: null };
}

async function devicePasskey(ctx: Ctx) {
  if (!ctx.sessionDevice) throw notFound("Este dispositivo no tiene huella registrada.");
  const [pk] = await ctx.db.select().from(passkey).where(eq(passkey.deviceId, ctx.sessionDevice.id));
  if (!pk) throw notFound("Este dispositivo no tiene huella registrada.");
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

/** Fingerprint unlock (also counts as a fresh re-auth for sensitive actions). */
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
  if (!result?.verified) return failAttempt(ctx, "passkey", "No se pudo verificar la huella.");
  await ctx.db
    .update(passkey)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: toDate(ctx.now) })
    .where(eq(passkey.id, pk.id));
  const d = await trustDevice(ctx);
  await succeedAttempt(ctx, "passkey", d.id);
  await audit({ ...ctx, sessionDevice: d }, "unlock", { method: "passkey" });
  return { device: await trustedOut(ctx, d) };
}

export async function deletePasskey(ctx: Ctx) {
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, requireDevice(ctx).id));
  await audit(ctx, "passkey_removed");
}

// ---------- devices ----------

export async function listDevices(ctx: Ctx) {
  const rows = await ctx.db.select().from(device).where(isNull(device.revokedAt)).orderBy(desc(device.lastSeenAt));
  return Promise.all(rows.map((d) => deviceOut(ctx, d)));
}

async function findDevice(ctx: Ctx, id: string) {
  const [d] = await ctx.db
    .select()
    .from(device)
    .where(and(eq(device.id, id), isNull(device.revokedAt)));
  if (!d) throw notFound("No encontré ese dispositivo.");
  return d;
}

export async function renameDevice(ctx: Ctx, id: string, name: string) {
  await findDevice(ctx, id);
  const d = one(await ctx.db.update(device).set({ name }).where(eq(device.id, id)).returning(), "device rename");
  await audit(ctx, "device_renamed", { deviceId: id });
  return deviceOut(ctx, d);
}

export async function revokeDevice(ctx: Ctx, id: string, kind: "device_revoked" | "logout" = "device_revoked") {
  await findDevice(ctx, id);
  await ctx.db
    .update(device)
    .set({ revokedAt: toDate(ctx.now) })
    .where(eq(device.id, id));
  await ctx.db.delete(passkey).where(eq(passkey.deviceId, id));
  await ctx.db.delete(pushSubscription).where(eq(pushSubscription.deviceId, id));
  await audit(ctx, kind, { deviceId: id });
  if (id === ctx.sessionDevice?.id) ctx.setCookies.push(clearCookie(SESSION_COOKIE));
}

// ---------- CLI ----------

/** `pnpm auth:reset-pin`: one-time 8-digit code valid 15 min. */
export async function createResetCode(db: DbLike, code: string, now: Temporal.Instant) {
  await db.insert(pinResetCode).values({ hash: await hashSecret(code), expiresAt: toDate(now.add({ minutes: 15 })) });
}

export { newRecoveryCodes };

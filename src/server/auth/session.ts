import { and, eq, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { one } from "../db/one";
import { device } from "../db/schema";
import type { DeviceRow } from "../domain/rows";
import { fromDate, toDate } from "../domain/time";
import { env } from "../env";
import { SESSION_COOKIE, setCookie } from "./cookies";
import { randomToken, sha256 } from "./crypto";

export interface SessionInfo {
  device: DeviceRow;
  /** Unused for more than PIN_REAUTH_DAYS: PIN or fingerprint needed. */
  locked: boolean;
}

const idleDays = (d: DeviceRow, now: Temporal.Instant) => fromDate(d.lastSeenAt).until(now).total("hours") / 24;

/** Resolves the session cookie to a non-revoked, non-expired device. */
export async function resolveSession(db: DbLike, token: string | undefined, now: Temporal.Instant): Promise<SessionInfo | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(device)
    .where(and(eq(device.sessionHash, sha256(token)), isNull(device.revokedAt)))
    .limit(1);
  if (!row) return null;
  const idle = idleDays(row, now);
  if (idle > env().DEVICE_TRUST_DAYS) return null;
  return { device: row, locked: idle > env().PIN_REAUTH_DAYS };
}

/** Marks activity (sliding expiry). Throttled to one write per minute. */
export async function touchDevice(db: DbLike, d: DeviceRow, now: Temporal.Instant) {
  if (fromDate(d.lastSeenAt).until(now).total("seconds") < 60) return;
  await db
    .update(device)
    .set({ lastSeenAt: toDate(now) })
    .where(eq(device.id, d.id));
}

/** Issues a fresh session token for a device (rotation on every unlock); returns the Set-Cookie header. */
export async function issueSession(db: DbLike, deviceId: string, now: Temporal.Instant): Promise<string> {
  const token = randomToken();
  await db
    .update(device)
    .set({ sessionHash: sha256(token), lastSeenAt: toDate(now), lastUnlockAt: toDate(now) })
    .where(eq(device.id, deviceId));
  return setCookie(SESSION_COOKIE, token, env().DEVICE_TRUST_DAYS * 86_400);
}

/** Creates a trusted device with a session; returns the row and the Set-Cookie header. */
export async function createDevice(db: DbLike, name: string, userAgent: string | null, now: Temporal.Instant) {
  const token = randomToken();
  const at = toDate(now);
  const row = one(
    await db
      .insert(device)
      .values({ name, userAgent, sessionHash: sha256(token), lastSeenAt: at, lastUnlockAt: at })
      .returning(),
    "device insert",
  );
  return { device: row, cookie: setCookie(SESSION_COOKIE, token, env().DEVICE_TRUST_DAYS * 86_400) };
}

/** True when PIN or fingerprint was confirmed on this device within `minutes` (token create/revoke). */
export const recentlyUnlocked = (d: DeviceRow, now: Temporal.Instant, minutes = 5) =>
  fromDate(d.lastUnlockAt).until(now).total("minutes") <= minutes;

/** "Galaxy S26 Ultra · Chrome"-ish name from a user agent. */
export function deviceNameFromUA(ua: string | null): string {
  if (!ua) return "Dispositivo";
  const os = /Android/.test(ua)
    ? /SM-S9\d\d/.test(ua)
      ? "Galaxy"
      : "Android"
    : /iPhone|iPad/.test(ua)
      ? "iPhone"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "Dispositivo";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  return `${os} · ${browser}`;
}

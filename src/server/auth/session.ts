import { and, eq, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { device } from "../db/schema";
import type { DeviceRow } from "../domain/rows";
import { env } from "../env";
import { randomToken, sha256 } from "./crypto";
import { SESSION_COOKIE, setCookie } from "./cookies";

const DAY = 86_400_000;

export interface SessionInfo {
  device: DeviceRow;
  /** Unused for more than PIN_REAUTH_DAYS: PIN or fingerprint needed. */
  locked: boolean;
}

/** Resolves the session cookie to a non-revoked, non-expired device. */
export async function resolveSession(db: DbLike, token: string | undefined, now: Date): Promise<SessionInfo | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(device)
    .where(and(eq(device.sessionHash, sha256(token)), isNull(device.revokedAt)))
    .limit(1);
  if (!row) return null;
  const idle = now.getTime() - row.lastSeenAt.getTime();
  if (idle > env().DEVICE_TRUST_DAYS * DAY) return null;
  return { device: row, locked: idle > env().PIN_REAUTH_DAYS * DAY };
}

/** Marks activity (sliding expiry). Throttled to one write per minute. */
export async function touchDevice(db: DbLike, d: DeviceRow, now: Date) {
  if (now.getTime() - d.lastSeenAt.getTime() < 60_000) return;
  await db.update(device).set({ lastSeenAt: now }).where(eq(device.id, d.id));
}

/** Issues a fresh session token for a device; returns the Set-Cookie header. */
export async function issueSession(db: DbLike, deviceId: string, now: Date): Promise<string> {
  const token = randomToken();
  await db.update(device).set({ sessionHash: sha256(token), lastSeenAt: now, lastUnlockAt: now }).where(eq(device.id, deviceId));
  return setCookie(SESSION_COOKIE, token, env().DEVICE_TRUST_DAYS * 86_400);
}

/** Creates a trusted device with a session; returns the row and the Set-Cookie header. */
export async function createDevice(db: DbLike, name: string, userAgent: string | null, now: Date) {
  const token = randomToken();
  const [row] = await db
    .insert(device)
    .values({ name, userAgent, sessionHash: sha256(token), lastSeenAt: now, lastUnlockAt: now })
    .returning();
  return { device: row, cookie: setCookie(SESSION_COOKIE, token, env().DEVICE_TRUST_DAYS * 86_400) };
}

/** "Galaxy S26 Ultra · Chrome"-ish name from a user agent. */
export function deviceNameFromUA(ua: string | null): string {
  if (!ua) return "Dispositivo";
  const os = /Android/.test(ua) ? (/SM-S9\d\d/.test(ua) ? "Galaxy" : "Android") : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Dispositivo";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${browser}`;
}

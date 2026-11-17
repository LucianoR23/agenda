import { eq } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { appUser } from "../db/schema";
import { ApiError } from "../http/errors";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "./time";

export interface Settings {
  timezone: string;
  locale: string;
  /** `HH:mm`, both or neither. */
  quietStart: string | null;
  quietEnd: string | null;
  defaultSnoozeMinutes: number;
  /** Reminders later than this are marked missed instead of pushed. */
  missedAfterHours: number;
}

const DEFAULTS: Settings = {
  timezone: DEFAULT_TIMEZONE,
  locale: "es-AR",
  quietStart: "23:30",
  quietEnd: "07:00",
  defaultSnoozeMinutes: 10,
  missedAfterHours: 12,
};

/** Single replica, single user: the settings row is cached in memory and invalidated on every update. */
let cached: Settings | null = null;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** The user's settings (defaults before setup). */
export async function getSettings(db: DbLike): Promise<Settings> {
  if (cached) return cached;
  const [u] = await db.select().from(appUser).limit(1);
  if (!u) return DEFAULTS; // not cached: setup will create the row
  cached = {
    timezone: u.timezone,
    locale: u.locale,
    quietStart: hhmm(u.quietStart),
    quietEnd: hhmm(u.quietEnd),
    defaultSnoozeMinutes: u.defaultSnoozeMinutes,
    missedAfterHours: u.missedAfterHours,
  };
  return cached;
}

/** The user's IANA timezone. */
export const userTimeZone = async (db: DbLike) => (await getSettings(db)).timezone;

export async function updateSettings(db: DbLike, patch: Partial<Settings>): Promise<Settings> {
  if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone))
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `"${patch.timezone}" no es una zona horaria IANA válida (por ejemplo America/Buenos_Aires).`,
      {
        fields: [{ path: "/timezone", message: "Unknown IANA timezone" }],
      },
    );
  const current = await getSettings(db);
  const next = { ...current, ...patch };
  if ((next.quietStart === null) !== (next.quietEnd === null))
    throw new ApiError(400, "VALIDATION_ERROR", "Las horas de silencio necesitan inicio y fin (o ninguno).", {
      fields: [{ path: "/quietStart", message: "Set both quietStart and quietEnd, or neither" }],
    });
  const [u] = await db.select({ id: appUser.id }).from(appUser).limit(1);
  if (!u) throw new ApiError(404, "SETUP_REQUIRED");
  await db
    .update(appUser)
    .set({
      timezone: next.timezone,
      locale: next.locale,
      quietStart: next.quietStart,
      quietEnd: next.quietEnd,
      defaultSnoozeMinutes: next.defaultSnoozeMinutes,
      missedAfterHours: next.missedAfterHours,
    })
    .where(eq(appUser.id, u.id));
  // invalidate rather than store: the request transaction may still roll back
  cached = null;
  return next;
}

/** Tests: forget the cached row (the test database is truncated between tests). */
export function resetSettingsCache() {
  cached = null;
}

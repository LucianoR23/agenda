/**
 * Time, the only way: Temporal (native in Node 26; the client loads temporal-polyfill when a browser lacks it).
 *
 * - Instants are `Temporal.Instant`; stored as `timestamptz` (drizzle hands us `Date`, convert at the edge with
 *   `toDate` / `fromDate`).
 * - Calendar dates travel as ISO strings (`YYYY-MM-DD`, the contract's `LocalDate`); local times as `HH:mm`, only
 *   together with a date and a timezone.
 * - The timezone is always explicit (IANA). The user's lives in `app_user.timezone`; `DEFAULT_TIMEZONE` is only the
 *   default for that setting.
 * - "Now" comes from a `Clock`, injectable for tests. Never `new Date()` arithmetic in domain code.
 *
 * Pure module (no server imports): the client re-exports it from `src/ui/time.ts`.
 */

export const DEFAULT_TIMEZONE = "America/Buenos_Aires";

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** A wall-clock time, `HH:mm` (24 h). */
export type LocalTime = string;

// ---------- clock ----------

export interface Clock {
  now(): Temporal.Instant;
}

export const systemClock: Clock = { now: () => Temporal.Now.instant() };

/** A clock that stays where you put it. `set` and `advance` move it (tests). */
export function fixedClock(at: Temporal.Instant | string) {
  let current = typeof at === "string" ? Temporal.Instant.from(at) : at;
  return {
    now: () => current,
    set(next: Temporal.Instant | string) {
      current = typeof next === "string" ? Temporal.Instant.from(next) : next;
    },
    advance(by: Temporal.DurationLike) {
      current = current.add(by);
    },
  };
}

let active: Clock = systemClock;

/** The process clock. Request handling reads it once per request (`ctx.now`). */
export const clock = (): Clock => active;

/** Tests only: replace the process clock; `null` restores the system clock. */
export function setClock(c: Clock | null) {
  active = c ?? systemClock;
}

export const now = (c: Clock = active): Temporal.Instant => c.now();

// ---------- timezones ----------

/** True for an IANA zone the runtime knows (`America/Buenos_Aires`), false for anything else. */
export function isValidTimeZone(tz: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

/** The instant seen from a timezone. */
export const zoned = (at: Temporal.Instant, tz: string): Temporal.ZonedDateTime => at.toZonedDateTimeISO(tz);

/** Today's date in `tz`. */
export const today = (tz: string, c: Clock = active): IsoDate => zoned(c.now(), tz).toPlainDate().toString();

/** The local date of an instant in `tz`. */
export const dateOf = (at: Temporal.Instant, tz: string): IsoDate => zoned(at, tz).toPlainDate().toString();

/** The local `HH:mm` of an instant in `tz`. */
export const timeOf = (at: Temporal.Instant, tz: string): LocalTime => zoned(at, tz).toPlainTime().toString({ smallestUnit: "minute" });

/**
 * The instant for a local date (+ optional `HH:mm`, default start of day) in `tz`. Nonexistent or repeated wall
 * times (DST transitions) resolve like a calendar app would: `compatible` (later for gaps, earlier for overlaps).
 */
export function toInstant(date: IsoDate, time: LocalTime | null | undefined, tz: string): Temporal.Instant {
  const d = Temporal.PlainDate.from(date);
  const zdt = time
    ? d.toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(tz, { disambiguation: "compatible" })
    : d.toZonedDateTime({ timeZone: tz });
  return zdt.toInstant();
}

/** ISO 8601 with the zone's real offset at that instant, millisecond precision: `2026-11-13T08:35:00.888-03:00`. */
export function formatInstant(at: Temporal.Instant | Date, tz: string): string {
  const instant = at instanceof Date ? fromDate(at) : at;
  return zoned(instant, tz).toString({ timeZoneName: "never", smallestUnit: "millisecond" });
}

// ---------- database boundary ----------

export const toDate = (at: Temporal.Instant): Date => new Date(at.epochMilliseconds);
export const fromDate = (d: Date): Temporal.Instant => Temporal.Instant.fromEpochMilliseconds(d.getTime());

// ---------- calendar dates ----------

const plain = (date: IsoDate) => Temporal.PlainDate.from(date);

export const addDays = (date: IsoDate, days: number): IsoDate => plain(date).add({ days }).toString();

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: IsoDate, to: IsoDate): number => plain(from).until(plain(to), { largestUnit: "days" }).days;

/** Monday of the ISO week containing `date`. */
export const weekStart = (date: IsoDate): IsoDate => {
  const d = plain(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
};

export const monthStart = (date: IsoDate): IsoDate => plain(date).with({ day: 1 }).toString();

export const monthEnd = (date: IsoDate): IsoDate => {
  const d = plain(date);
  return d.with({ day: d.daysInMonth }).toString();
};

/** Every date from `from` to `to`, inclusive (empty when `to` is earlier). */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = plain(from), end = plain(to); Temporal.PlainDate.compare(d, end) <= 0; d = d.add({ days: 1 })) out.push(d.toString());
  return out;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const dayOfWeek = (date: IsoDate): number => plain(date).dayOfWeek;

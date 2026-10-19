/**
 * Time helpers for America/Buenos_Aires (fixed UTC-03:00, no DST since 2009).
 * All "now" reads go through `now()` so tests can control the clock with vi.setSystemTime.
 */
export const TZ = "America/Buenos_Aires";
const OFFSET_MIN = -180;
const DAY_MS = 86_400_000;

export const now = () => new Date();

/** Local calendar date `YYYY-MM-DD` of an instant. */
export function localDate(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Local `HH:mm` (00:00–23:59) of an instant. */
export function localTime(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

/** ISO 8601 with the -03:00 offset, e.g. `2026-10-19T07:00:04.812-03:00`. */
export function isoLocal(at: Date | string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Date(d.getTime() + OFFSET_MIN * 60_000).toISOString().replace("Z", "-03:00");
}

export const isoLocalOrNull = (at: Date | string | null): string | null => (at === null ? null : isoLocal(at));

/** Instant for a local date + block time (`HH:mm`, 00:00–29:59). */
export function instantAt(date: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MIN * 60_000 + (h * 60 + m) * 60_000);
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const monthEnd = (date: string) => addDays(`${new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 1)).toISOString().slice(0, 10)}`, -1);

/** `HH:mm` (00:00–29:59) ↔ minutes since the day's 00:00. */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Night a sleep event belongs to: before 12:00 → the previous day's night. */
export const sleepNightFor = (at: Date) => (localTime(at) < "12:00" ? addDays(localDate(at), -1) : localDate(at));

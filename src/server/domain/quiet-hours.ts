import type { LocalTime } from "./time";

/**
 * Quiet hours: a non-urgent reminder due inside the window is delivered when it ends. The window is local time in the
 * user's timezone and may cross midnight (23:30 → 07:00).
 */
export interface QuietHours {
  start: LocalTime | null;
  end: LocalTime | null;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** True when local `time` falls inside [start, end). */
export function inQuietHours(time: LocalTime, q: QuietHours): boolean {
  if (!q.start || !q.end || q.start === q.end) return false;
  const t = minutes(time);
  const s = minutes(q.start);
  const e = minutes(q.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/**
 * When a reminder due at `at` should actually go out: `at` itself, or the end of the quiet window it falls in (same
 * night, so 23:45 → 07:00 next morning and 01:00 → 07:00 that morning).
 */
export function effectiveDue(at: Temporal.Instant, tz: string, q: QuietHours, urgent: boolean): Temporal.Instant {
  if (urgent || !q.start || !q.end) return at;
  const local = at.toZonedDateTimeISO(tz);
  const time = local.toPlainTime().toString({ smallestUnit: "minute" });
  if (!inQuietHours(time, q)) return at;
  const crossesMidnight = minutes(q.start) > minutes(q.end);
  const endDay = crossesMidnight && minutes(time) >= minutes(q.start) ? local.toPlainDate().add({ days: 1 }) : local.toPlainDate();
  return endDay.toPlainDateTime(Temporal.PlainTime.from(q.end)).toZonedDateTime(tz, { disambiguation: "compatible" }).toInstant();
}

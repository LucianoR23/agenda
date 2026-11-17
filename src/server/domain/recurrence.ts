import { RRuleTemporal } from "rrule-temporal";
import { ApiError } from "../http/errors";
import { addDays, type IsoDate, type LocalTime } from "./time";

/**
 * RRULE helpers for recurring tasks (RFC 5545 via rrule-temporal, expanded in the user's timezone so local times
 * survive DST changes). A task stores only the RRULE body (`FREQ=WEEKLY;BYDAY=MO`); its due date (+ time) is the
 * DTSTART of the current occurrence.
 */

/** Frequencies a task may use (no hourly/minutely tasks). */
const TASK_FREQS = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const invalid = (message: string) =>
  new ApiError(400, "VALIDATION_ERROR", message, { fields: [{ path: "/rrule", message: "Invalid recurrence rule" }] });

/** Splits an RRULE body into its parts (`FREQ=WEEKLY;COUNT=3` → { FREQ: "WEEKLY", COUNT: "3" }). */
function parts(rrule: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of rrule.split(";")) {
    const [k, v] = p.split("=");
    if (k && v) out.set(k.trim().toUpperCase(), v.trim().toUpperCase());
  }
  return out;
}

const join = (p: Map<string, string>) => [...p].map(([k, v]) => `${k}=${v}`).join(";");

const dtstartOf = (dueDate: IsoDate, dueTime: LocalTime | null, tz: string) =>
  Temporal.PlainDate.from(dueDate)
    .toPlainDateTime(dueTime ? Temporal.PlainTime.from(dueTime) : undefined)
    .toZonedDateTime(tz, { disambiguation: "compatible" });

const rule = (rrule: string, dueDate: IsoDate, dueTime: LocalTime | null, tz: string) =>
  new RRuleTemporal({ rruleString: rrule, dtstart: dtstartOf(dueDate, dueTime, tz), maxIterations: 10_000 });

/**
 * Validates and normalizes a task RRULE: uppercase, no `RRULE:` prefix, no DTSTART (the due date is), a daily or
 * longer frequency. Throws a Spanish VALIDATION_ERROR otherwise.
 */
export function normalizeTaskRrule(input: string, dueDate: IsoDate, dueTime: LocalTime | null, tz: string): string {
  const body = input.trim().replace(/^RRULE:/i, "");
  if (/DTSTART/i.test(body)) throw invalid("La regla de repetición no lleva DTSTART: la fecha de la tarea es el inicio.");
  const p = parts(body);
  const freq = p.get("FREQ");
  if (!freq || !TASK_FREQS.has(freq))
    throw invalid("La repetición tiene que ser diaria, semanal, mensual o anual (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY).");
  const normalized = join(p);
  try {
    rule(normalized, dueDate, dueTime, tz).next();
  } catch {
    throw invalid(`No entendí la regla de repetición "${input}".`);
  }
  return normalized;
}

export interface NextOccurrence {
  dueDate: IsoDate;
  /** The RRULE for the new occurrence (COUNT decremented, so a "3 times" series really ends). */
  rrule: string;
}

/**
 * The occurrence that follows a completed one: the first date after both its due date and today. Missed occurrences
 * are skipped and completing counts for today, so an overdue daily task (due Friday) completed on Monday comes back
 * on Tuesday. Completing early (due Wednesday, done Monday) gives the occurrence after Wednesday. Null when the
 * series ended (UNTIL passed or COUNT used up).
 */
export function nextOccurrence(
  rrule: string,
  dueDate: IsoDate,
  dueTime: LocalTime | null,
  tz: string,
  today: IsoDate,
): NextOccurrence | null {
  const p = parts(rrule);
  const count = p.has("COUNT") ? Number(p.get("COUNT")) : null;
  if (count !== null && count <= 1) return null;

  const r = rule(rrule, dueDate, dueTime, tz);
  // start looking the day after the later of "the completed occurrence" and "today"
  const from = addDays(dueDate > today ? dueDate : today, 1);
  const fromZdt = Temporal.PlainDate.from(from).toZonedDateTime({ timeZone: tz });
  const next = r.next(fromZdt, true);
  if (!next) return null;

  if (count !== null) {
    // occurrences strictly between the completed one (DTSTART) and `next`: missed ones count as used
    const missed = r.between(dtstartOf(dueDate, dueTime, tz), next, false).length;
    const left = count - 1 - missed;
    if (left < 1) return null;
    p.set("COUNT", String(left));
  }
  return { dueDate: next.toPlainDate().toString(), rrule: join(p) };
}

/** Frequencies a reminder may use (an hourly reminder is fine; minutely is not). */
const REMINDER_FREQS = new Set(["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const ruleAt = (rrule: string, dtstart: Temporal.ZonedDateTime) =>
  new RRuleTemporal({ rruleString: rrule, dtstart, maxIterations: 10_000 });

/** Validates and normalizes a reminder RRULE (anchored at its fire time, in the user's timezone). */
export function normalizeReminderRrule(input: string, fireAt: Temporal.Instant, tz: string): string {
  const body = input.trim().replace(/^RRULE:/i, "");
  if (/DTSTART/i.test(body)) throw invalid("La regla de repetición no lleva DTSTART: la hora del recordatorio es el inicio.");
  const p = parts(body);
  const freq = p.get("FREQ");
  if (!freq || !REMINDER_FREQS.has(freq))
    throw invalid("La repetición tiene que ser por hora, día, semana, mes o año (FREQ=HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY).");
  const normalized = join(p);
  try {
    ruleAt(normalized, fireAt.toZonedDateTimeISO(tz)).next();
  } catch {
    throw invalid(`No entendí la regla de repetición "${input}".`);
  }
  return normalized;
}

/**
 * The fire time after `after` for a recurring reminder whose current occurrence is `anchor` (its original time, even
 * if this occurrence was snoozed). Missed occurrences are skipped and consume COUNT. Null when the series ended.
 */
export function nextReminderFire(
  rrule: string,
  anchor: Temporal.Instant,
  tz: string,
  after: Temporal.Instant,
): { fireAt: Temporal.Instant; rrule: string } | null {
  const p = parts(rrule);
  const count = p.has("COUNT") ? Number(p.get("COUNT")) : null;
  if (count !== null && count <= 1) return null;
  const dtstart = anchor.toZonedDateTimeISO(tz);
  const r = ruleAt(rrule, dtstart);
  const next = r.next(after.toZonedDateTimeISO(tz), false);
  if (!next) return null;
  if (count !== null) {
    const missed = r.between(dtstart, next, false).length;
    const left = count - 1 - missed;
    if (left < 1) return null;
    p.set("COUNT", String(left));
  }
  return { fireAt: next.toInstant(), rrule: join(p) };
}

/** Frequencies an event may use (daily or longer, like tasks). */
const EVENT_FREQS = TASK_FREQS;

/** Validates and normalizes an event RRULE (anchored at the event's start in its timezone). */
export function normalizeEventRrule(input: string, dtstart: Temporal.ZonedDateTime): string {
  const body = input.trim().replace(/^RRULE:/i, "");
  if (/DTSTART/i.test(body)) throw invalid("La regla de repetición no lleva DTSTART: el inicio del evento es el inicio.");
  const p = parts(body);
  const freq = p.get("FREQ");
  if (!freq || !EVENT_FREQS.has(freq))
    throw invalid("La repetición tiene que ser diaria, semanal, mensual o anual (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY).");
  const normalized = join(p);
  try {
    ruleAt(normalized, dtstart).next();
  } catch {
    throw invalid(`No entendí la regla de repetición "${input}".`);
  }
  return normalized;
}

/**
 * Starts of a recurring event's occurrences that overlap [from, to): those starting before `to` and ending after
 * `from` (an occurrence lasts `durationMs`). The first occurrence is DTSTART itself.
 */
export function eventOccurrences(
  rrule: string,
  dtstart: Temporal.ZonedDateTime,
  durationMs: number,
  from: Temporal.Instant,
  to: Temporal.Instant,
  max = 500,
): Temporal.ZonedDateTime[] {
  const r = ruleAt(rrule, dtstart);
  const after = from.subtract({ milliseconds: durationMs }).toZonedDateTimeISO(dtstart.timeZoneId);
  const before = to.toZonedDateTimeISO(dtstart.timeZoneId);
  if (Temporal.ZonedDateTime.compare(before, dtstart) <= 0) return [];
  return r
    .between(after, before, true)
    .filter(
      (z) =>
        Temporal.Instant.compare(z.toInstant(), to) < 0 &&
        (Temporal.Instant.compare(z.toInstant(), from) >= 0 ||
          Temporal.Instant.compare(z.toInstant().add({ milliseconds: durationMs }), from) > 0),
    )
    .slice(0, max);
}

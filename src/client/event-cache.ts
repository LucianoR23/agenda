import { userTimeZone } from "@/ui/time";
import type { AgendaEvent, EventQuery } from "./types";

/** Start and end of an occurrence as instants (all-day: midnight in the user's zone, end exclusive). */
export function spanOf(e: AgendaEvent, tz = userTimeZone()) {
  if (e.allDay && e.startDate) {
    const start = Temporal.PlainDate.from(e.startDate).toZonedDateTime({ timeZone: tz }).toInstant();
    const end = e.endDate ? Temporal.PlainDate.from(e.endDate).toZonedDateTime({ timeZone: tz }).toInstant() : start.add({ hours: 24 });
    return { start, end };
  }
  const start = Temporal.Instant.from(e.startsAt as string);
  return { start, end: e.endsAt ? Temporal.Instant.from(e.endsAt) : start };
}

/** Client mirror of the server's range filter: does the occurrence overlap [from, to]? */
export function inRange(e: AgendaEvent, q: Pick<EventQuery, "from" | "to">, tz = userTimeZone()) {
  const from = Temporal.PlainDate.from(q.from).toZonedDateTime({ timeZone: tz }).toInstant();
  const to = Temporal.PlainDate.from(q.to).add({ days: 1 }).toZonedDateTime({ timeZone: tz }).toInstant();
  const s = spanOf(e, tz);
  return (
    Temporal.Instant.compare(s.start, to) < 0 && (Temporal.Instant.compare(s.end, from) > 0 || Temporal.Instant.compare(s.start, from) >= 0)
  );
}

/** Same order as the server: day, all-day first, then start time, then title. */
export function sortKey(e: AgendaEvent, tz = userTimeZone()) {
  if (e.allDay && e.startDate) return `${e.startDate} 0`;
  const z = Temporal.Instant.from(e.startsAt as string).toZonedDateTimeISO(tz);
  return `${z.toPlainDate()} 1 ${z.toPlainTime()}`;
}

export const byStart = (a: AgendaEvent, b: AgendaEvent) => {
  const ka = sortKey(a);
  const kb = sortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : a.title.localeCompare(b.title, "es");
};

/** Replaces every occurrence of the event with the given one (when it falls in the cached range). */
export function putEvent(list: AgendaEvent[], e: AgendaEvent, q: EventQuery): AgendaEvent[] {
  const rest = list.filter((x) => x.eventId !== e.eventId);
  if (!inRange(e, q)) return rest;
  return [...rest, e].sort(byStart);
}

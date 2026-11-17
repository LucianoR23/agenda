import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { calendarSource, event, externalEvent, reminder } from "../db/schema";
import { eventOccurrences } from "./recurrence";
import { getSettings } from "./settings";
import { fromDate, timeOf, toDate, toInstant } from "./time";

/**
 * Event reminders are materialized as ordinary reminder rows (docs/v2/05): for every occurrence starting within the
 * next 48 h, one reminder per offset ("30 min antes"), so the dispatcher, quiet hours, Listo / Posponer and the
 * Recordatorios screen treat them like any other. Idempotent: a (event, offset, occurrence) is created once, ever
 * (a cancelled one is not brought back).
 *
 * - Local events: `event.reminder_offsets`. All-day events count offsets back from 09:00 of their day.
 * - Google/iCal: the calendar's `reminder_minutes` (off by default; Google already notifies), timed events only.
 */
export const HORIZON_HOURS = 48;
/** All-day events are "at" 09:00 for reminders (offset 0 → 09:00 that day, 1440 → 09:00 the day before). */
export const ALL_DAY_ANCHOR = "09:00";

type Key = string;
const key = (id: string, offset: number, occurrence: Date | Temporal.Instant) =>
  `${id}|${offset}|${occurrence instanceof Date ? occurrence.getTime() : occurrence.epochMilliseconds}`;

function bodyFor(start: Temporal.Instant, allDay: boolean, offset: number, location: string | null, tz: string) {
  const when = allDay ? "Todo el día" : offset === 0 ? "Ahora" : `A las ${timeOf(start, tz)}`;
  return location ? `${when} · ${location}` : when;
}

export interface MaterializeResult {
  created: number;
}

/** Creates the reminders due within the horizon. `eventId` / `sourceId` limit it to one event or calendar. */
export async function materializeEventReminders(
  db: DbLike,
  now: Temporal.Instant,
  only: { eventId?: string; sourceId?: string } = {},
): Promise<MaterializeResult> {
  const horizon = now.add({ hours: HORIZON_HOURS });
  let created = 0;

  // ---- local events ----
  if (!only.sourceId) {
    const rows = await db
      .select()
      .from(event)
      .where(
        and(isNull(event.deletedAt), sql`cardinality(${event.reminderOffsets}) > 0`, ...(only.eventId ? [eq(event.id, only.eventId)] : [])),
      );
    for (const r of rows) {
      const maxOffset = Math.max(...r.reminderOffsets);
      // an occurrence matters if one of its offsets lands in (now, horizon]
      const from = now;
      const to = horizon.add({ minutes: maxOffset + 24 * 60 });
      const allDay = r.allDay && r.startDate && r.endDate;
      const anchors: Temporal.Instant[] = [];
      if (r.rrule) {
        const dtstart = allDay
          ? Temporal.PlainDate.from(r.startDate as string).toZonedDateTime({ timeZone: r.timezone })
          : fromDate(r.startsAt as Date).toZonedDateTimeISO(r.timezone);
        for (const z of eventOccurrences(r.rrule, dtstart, 0, from.subtract({ hours: 24 }), to, 200))
          anchors.push(allDay ? toInstant(z.toPlainDate().toString(), ALL_DAY_ANCHOR, r.timezone) : z.toInstant());
      } else if (allDay) anchors.push(toInstant(r.startDate as string, ALL_DAY_ANCHOR, r.timezone));
      else if (r.startsAt) anchors.push(fromDate(r.startsAt));

      const candidates = anchors.flatMap((start) =>
        r.reminderOffsets
          .map((offset) => ({ start, offset, fireAt: start.subtract({ minutes: offset }) }))
          .filter((c) => Temporal.Instant.compare(c.fireAt, now) > 0 && Temporal.Instant.compare(c.fireAt, horizon) <= 0),
      );
      if (!candidates.length) continue;
      const existing = new Set<Key>(
        (
          await db
            .select({ o: reminder.offsetMinutes, at: reminder.eventOccurrenceAt })
            .from(reminder)
            .where(and(eq(reminder.eventId, r.id), isNotNull(reminder.offsetMinutes)))
        ).map((x) => key(r.id, x.o as number, x.at as Date)),
      );
      for (const c of candidates) {
        if (existing.has(key(r.id, c.offset, c.start))) continue;
        const inserted = await db
          .insert(reminder)
          .values({
            title: r.title,
            body: bodyFor(c.start, Boolean(allDay), c.offset, r.location, r.timezone),
            fireAt: toDate(c.fireAt),
            eventId: r.id,
            offsetMinutes: c.offset,
            eventOccurrenceAt: toDate(c.start),
            source: "system",
            updatedBy: "system",
          })
          .onConflictDoNothing()
          .returning({ id: reminder.id });
        created += inserted.length;
      }
    }
  }

  // ---- Google / iCal calendars with an automatic reminder ----
  if (!only.eventId) {
    const rows = await db
      .select({ e: externalEvent, minutes: calendarSource.reminderMinutes })
      .from(externalEvent)
      .innerJoin(calendarSource, eq(calendarSource.id, externalEvent.sourceId))
      .where(
        and(
          eq(calendarSource.enabled, true),
          isNotNull(calendarSource.reminderMinutes),
          eq(externalEvent.allDay, false),
          gt(externalEvent.startsAt, toDate(now)),
          lte(externalEvent.startsAt, toDate(horizon.add({ hours: 24 }))),
          ...(only.sourceId ? [eq(calendarSource.id, only.sourceId)] : []),
        ),
      );
    const ids = rows.map((x) => x.e.id);
    const existing = new Set<Key>(
      ids.length
        ? (
            await db
              .select({ id: reminder.externalEventId, o: reminder.offsetMinutes, at: reminder.eventOccurrenceAt })
              .from(reminder)
              .where(and(inArray(reminder.externalEventId, ids), isNotNull(reminder.offsetMinutes)))
          ).map((x) => key(x.id as string, x.o as number, x.at as Date))
        : [],
    );
    const tz = (await getSettings(db)).timezone;
    for (const { e, minutes } of rows) {
      const start = fromDate(e.startsAt as Date);
      const offset = minutes as number;
      const fireAt = start.subtract({ minutes: offset });
      if (Temporal.Instant.compare(fireAt, now) <= 0 || Temporal.Instant.compare(fireAt, horizon) > 0) continue;
      if (existing.has(key(e.id, offset, start))) continue;
      const inserted = await db
        .insert(reminder)
        .values({
          title: e.title,
          body: bodyFor(start, false, offset, e.location, tz),
          fireAt: toDate(fireAt),
          externalEventId: e.id,
          offsetMinutes: offset,
          eventOccurrenceAt: toDate(start),
          source: "system",
          updatedBy: "system",
        })
        .onConflictDoNothing()
        .returning({ id: reminder.id });
      created += inserted.length;
    }
  }
  return { created };
}

/**
 * Removes the pending automatic reminders of an event or a calendar before they're recomputed (the event moved, its
 * offsets changed, it was deleted, the calendar's minutes changed). Never delivered → nothing lost; delivered,
 * done, cancelled and hand-made ("Recordarme") ones stay.
 */
export async function clearEventReminders(db: DbLike, scope: { eventId?: string; sourceId?: string }) {
  const pending = and(eq(reminder.status, "scheduled"), eq(reminder.source, "system"), isNotNull(reminder.offsetMinutes));
  if (scope.eventId) await db.delete(reminder).where(and(pending, eq(reminder.eventId, scope.eventId)));
  if (scope.sourceId)
    await db
      .delete(reminder)
      .where(
        and(
          pending,
          inArray(
            reminder.externalEventId,
            db.select({ id: externalEvent.id }).from(externalEvent).where(eq(externalEvent.sourceId, scope.sourceId)),
          ),
        ),
      );
}

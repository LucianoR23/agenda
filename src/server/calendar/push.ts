import { and, count, eq, gte, isNotNull, isNull, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { calendarSource, event, googleCredential, googleEventPush } from "../db/schema";
import { getSettings } from "../domain/settings";
import { addDays, toDate } from "../domain/time";
import { env } from "../env";
import { log } from "../log";
import {
  createCalendar,
  deleteEvent,
  GoogleError,
  type GoogleEventBody,
  insertEvent,
  listCalendars,
  PUSH_SCOPE,
  updateEvent,
} from "./google";
import { open } from "./secretbox";
import { markInvalid } from "./sync";

/**
 * Copies local events to the "Agenda" calendar in Google (docs/v2/06, phase 10b): one way, Agenda → Google. Every
 * minute the worker writes what changed: an event is pending while its version differs from the one last written
 * (`google_event_push`). The Google event id is derived from ours, so a retry never duplicates. Edits made in Google
 * are overwritten by the next change in Agenda. Events go without Google reminders (Agenda's pushes notify).
 */

type EventRow = typeof event.$inferSelect;
type PushRow = typeof googleEventPush.$inferSelect;

/** Events per pass: a first copy of a long history spreads over a few minutes, within Google's quotas. */
const BATCH = 50;
/** Past events copied on the first pass (like the read window); recurring ones always go. */
const PAST_DAYS = 7;
/** Backoff after a failed event: 2, 4, 8 … minutes, at most a day. */
const MAX_BACKOFF_MINUTES = 1440;

export interface PushReport {
  pushed: number;
  failed: number;
}

/** Marks the "Agenda" calendar so a reconnect finds it again instead of creating another. */
export const calendarMarker = () => `[agenda:${new URL(env().APP_ORIGIN).host}]`;

/** Google ids: base32hex (0-9, a-v), 5–1024 chars. A uuid without dashes is already that. */
export const googleEventId = (eventId: string) => eventId.replace(/-/g, "");

export function toGoogle(r: EventRow): GoogleEventBody {
  const when = (d: Date) => ({ dateTime: d.toISOString(), timeZone: r.timezone });
  const timed = !r.allDay && r.startsAt;
  return {
    id: googleEventId(r.id),
    summary: r.title,
    ...(r.notes ? { description: r.notes } : {}),
    ...(r.location ? { location: r.location } : {}),
    start: timed ? when(r.startsAt as Date) : { date: r.startDate as string },
    end: timed ? when(r.endsAt ?? (r.startsAt as Date)) : { date: r.endDate as string },
    ...(r.rrule ? { recurrence: [`RRULE:${r.rrule}`] } : {}),
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { agendaEventId: r.id } },
    status: "confirmed",
  };
}

/** What still has to reach Google: changed live events (recent or recurring) and deletions of copied ones. */
function pendingWhere(now: Temporal.Instant, tz: string): SQL {
  const since = now.subtract({ hours: PAST_DAYS * 24 });
  const sinceDate = addDays(now.toZonedDateTimeISO(tz).toPlainDate().toString(), -PAST_DAYS);
  const live = and(
    isNull(event.deletedAt),
    sql`${googleEventPush.pushedVersion} IS DISTINCT FROM ${event.version}`,
    or(
      isNotNull(event.rrule),
      sql`coalesce(${event.endsAt}, ${event.startsAt}) >= ${toDate(since).toISOString()}::timestamptz`,
      gte(event.endDate, sinceDate),
    ),
  );
  const removed = and(
    isNotNull(event.deletedAt),
    isNotNull(googleEventPush.pushedVersion),
    ne(googleEventPush.pushedVersion, event.version),
  );
  return or(live, removed) as SQL;
}

const due = (now: Temporal.Instant) => or(isNull(googleEventPush.nextAttemptAt), lte(googleEventPush.nextAttemptAt, toDate(now))) as SQL;

async function pending(db: DbLike, now: Temporal.Instant, tz: string): Promise<Array<{ e: EventRow; p: PushRow | null }>> {
  return db
    .select({ e: event, p: googleEventPush })
    .from(event)
    .leftJoin(googleEventPush, eq(googleEventPush.eventId, event.id))
    .where(and(pendingWhere(now, tz), due(now)))
    .orderBy(event.updatedAt)
    .limit(BATCH);
}

/** For Ajustes: how many events wait to be copied, and how many of them failed last time. */
export async function pushBacklog(db: DbLike, now: Temporal.Instant, tz: string) {
  const [all] = await db
    .select({ n: count() })
    .from(event)
    .leftJoin(googleEventPush, eq(googleEventPush.eventId, event.id))
    .where(pendingWhere(now, tz));
  const [failed] = await db
    .select({ n: count(), error: sql<string | null>`max(${googleEventPush.lastError})` })
    .from(event)
    .innerJoin(googleEventPush, eq(googleEventPush.eventId, event.id))
    .where(and(pendingWhere(now, tz), isNotNull(googleEventPush.lastError)));
  return { pending: all?.n ?? 0, failed: failed?.n ?? 0, lastError: failed?.error ?? null };
}

async function markPushed(db: DbLike, eventId: string, version: number, now: Temporal.Instant) {
  const values = { pushedVersion: version, pushedAt: toDate(now), lastError: null, attempts: 0, nextAttemptAt: null };
  await db
    .insert(googleEventPush)
    .values({ eventId, ...values })
    .onConflictDoUpdate({ target: googleEventPush.eventId, set: values });
}

async function markFailed(db: DbLike, eventId: string, p: PushRow | null, error: string, now: Temporal.Instant) {
  const attempts = (p?.attempts ?? 0) + 1;
  const minutes = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES);
  const values = { lastError: error.slice(0, 500), attempts, nextAttemptAt: toDate(now.add({ minutes })) };
  await db
    .insert(googleEventPush)
    .values({ eventId, pushedVersion: null, ...values })
    .onConflictDoUpdate({ target: googleEventPush.eventId, set: values });
}

/** The "Agenda" calendar: the one already marked as ours (after a reconnect), or a new one. */
async function ensureCalendar(db: DbLike, refreshToken: string, credentialId: string, tz: string): Promise<string> {
  const marker = calendarMarker();
  const existing = (await listCalendars(refreshToken)).find((c) => c.description?.includes(marker));
  const id =
    existing?.id ??
    (await createCalendar(refreshToken, {
      summary: "Agenda",
      description: `Eventos de Agenda. Se editan desde Agenda: los cambios hechos acá se pisan con el próximo cambio allá. ${marker}`,
      timeZone: tz,
    }));
  await db.update(googleCredential).set({ agendaCalendarId: id }).where(eq(googleCredential.id, credentialId));
  // never read back what Agenda writes
  await db.delete(calendarSource).where(and(eq(calendarSource.kind, "google"), eq(calendarSource.externalCalendarId, id)));
  log.info("google agenda calendar ready", { created: !existing });
  return id;
}

/** Writes one event; the calendar being gone (deleted in Google) surfaces as `calendarGone`. */
async function write(refreshToken: string, calendarId: string, e: EventRow, copiedBefore: boolean) {
  if (e.deletedAt) return deleteEvent(refreshToken, calendarId, googleEventId(e.id));
  const body = toGoogle(e);
  const insert = async () => {
    try {
      await insertEvent(refreshToken, calendarId, body);
    } catch (err) {
      // already there (an earlier attempt, a reconnect, or deleted in Google: an update brings it back)
      if (err instanceof GoogleError && err.status === 409) return updateEvent(refreshToken, calendarId, body);
      if (err instanceof GoogleError && err.status === 404) throw new CalendarGone();
      throw err;
    }
  };
  if (!copiedBefore) return insert();
  try {
    await updateEvent(refreshToken, calendarId, body);
  } catch (err) {
    if (err instanceof GoogleError && err.status === 404) return insert();
    throw err;
  }
}

class CalendarGone extends Error {}

let running: Promise<PushReport> | null = null;
let queued: Promise<PushReport> | null = null;

/**
 * One pass (the worker runs it every minute; enabling the switch runs one right away). Never overlaps itself: called
 * while a pass runs, it queues one more that starts when that one ends (so it sees what changed meanwhile); callers
 * in between share that queued pass.
 */
export function pushToGoogle(db: DbLike, now: Temporal.Instant): Promise<PushReport> {
  if (running) {
    queued ??= running.then(() => {
      queued = null;
      return pushToGoogle(db, now);
    });
    return queued;
  }
  running = runPush(db, now).finally(() => {
    running = null;
  });
  return running;
}

async function runPush(db: DbLike, now: Temporal.Instant): Promise<PushReport> {
  const report: PushReport = { pushed: 0, failed: 0 };
  const [cred] = await db.select().from(googleCredential).limit(1);
  if (!cred || cred.invalidAt || !cred.pushEnabled || !cred.scopes.includes(PUSH_SCOPE)) return report;
  const tz = (await getSettings(db)).timezone;
  const refreshToken = open(cred.refreshTokenEnc);
  try {
    const calendarId = cred.agendaCalendarId ?? (await ensureCalendar(db, refreshToken, cred.id, tz));
    for (const { e, p } of await pending(db, now, tz)) {
      try {
        await write(refreshToken, calendarId, e, p?.pushedVersion != null);
        await markPushed(db, e.id, e.version, now);
        report.pushed++;
      } catch (err) {
        if (err instanceof CalendarGone) throw err;
        // the whole connection or Google itself: stop here, the next pass retries
        if (err instanceof GoogleError && ["invalid_grant", "rate_limited", "unavailable"].includes(err.kind)) throw err;
        report.failed++;
        await markFailed(db, e.id, p, err instanceof GoogleError ? err.message : "Error inesperado al copiar a Google.", now);
        if (!(err instanceof GoogleError)) log.error("google push failed", { event: e.id, err });
      }
    }
  } catch (err) {
    if (err instanceof CalendarGone) {
      // Lemy deleted the "Agenda" calendar in Google: the next pass creates it again and copies everything
      log.warn("google agenda calendar gone; recreating");
      await db.update(googleCredential).set({ agendaCalendarId: null }).where(eq(googleCredential.id, cred.id));
      await db.delete(googleEventPush);
    } else if (err instanceof GoogleError && err.kind === "invalid_grant") await markInvalid(db, now);
    else if (err instanceof GoogleError) log.warn("google push paused", { kind: err.kind, status: err.status });
    else throw err;
  }
  if (report.pushed || report.failed) log.info("google push", { ...report });
  return report;
}

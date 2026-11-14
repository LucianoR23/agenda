import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { calendarSource, externalEvent, googleCredential, reminder } from "../db/schema";
import { materializeEventReminders } from "../domain/event-reminders";
import { getSettings } from "../domain/settings";
import { fromDate, toDate, toInstant } from "../domain/time";
import { log } from "../log";
import { sendNotice } from "../push";
import { GoogleError, type GoogleEvent, listCalendars, listEvents } from "./google";
import { fetchIcal, IcalError, parseIcal } from "./ical";
import { open } from "./secretbox";
import type { Incoming } from "./types";

/** docs/v2/06: a window around now, re-read whole every time (simple and self-healing). */
export const WINDOW = { pastDays: 7, futureDays: 120 } as const;
/** Minutes between syncs per kind. */
export const INTERVAL_MINUTES = { google: 5, ical: 15 } as const;
/** Backoff after errors: 5, 10, 20 … minutes, at most 6 h. */
const BACKOFF_BASE_MINUTES = 5;
const BACKOFF_MAX_MINUTES = 360;

type Source = typeof calendarSource.$inferSelect;
type Row = typeof externalEvent.$inferSelect;

export interface SyncReport {
  synced: number;
  failed: number;
  skipped: number;
  upserted: number;
  deleted: number;
}

/** In-memory backoff per source (single replica). */
const backoff = new Map<string, { failures: number; until: number }>();

export const resetSyncState = () => backoff.clear();

export const windowAround = (now: Temporal.Instant) => ({
  from: now.subtract({ hours: WINDOW.pastDays * 24 }),
  to: now.add({ hours: WINDOW.futureDays * 24 }),
});

const fingerprint = (e: Incoming) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        e.title,
        e.location,
        e.allDay,
        e.startsAt?.toString(),
        e.endsAt?.toString(),
        e.startDate,
        e.endDate,
        e.status,
        e.htmlLink,
      ]),
    )
    .digest("base64url")
    .slice(0, 22);

/** Start/end of a stored or incoming event as instants (all-day dates at midnight in the user's zone). */
function span(
  e: Pick<Row, "allDay" | "startDate" | "endDate"> & { startsAt: Temporal.Instant | null; endsAt: Temporal.Instant | null },
  tz: string,
) {
  if (e.allDay && e.startDate) {
    const start = toInstant(e.startDate, null, tz);
    return { start, end: e.endDate ? toInstant(e.endDate, null, tz) : start.add({ hours: 24 }) };
  }
  const start = e.startsAt ?? Temporal.Instant.fromEpochMilliseconds(0);
  return { start, end: e.endsAt ?? start };
}

const overlaps = (s: { start: Temporal.Instant; end: Temporal.Instant }, w: { from: Temporal.Instant; to: Temporal.Instant }) =>
  Temporal.Instant.compare(s.start, w.to) < 0 && Temporal.Instant.compare(s.end, w.from) >= 0;

/** Google's shape → ours. Cancelled instances come back as `null` (they're deletions). */
export function fromGoogle(e: GoogleEvent): Incoming | null {
  if (e.status === "cancelled" || !e.start) return null;
  const base = {
    externalId: e.id,
    title: e.summary?.trim() || "(Sin título)",
    location: e.location?.trim() || null,
    status: e.status === "tentative" ? ("tentative" as const) : ("confirmed" as const),
    htmlLink: e.htmlLink && /^https:\/\/(www\.)?google\.com\//.test(e.htmlLink) ? e.htmlLink : null,
    updatedRemoteAt: e.updated ? Temporal.Instant.from(e.updated) : null,
  };
  if (e.start.date) {
    const end = e.end?.date && e.end.date > e.start.date ? e.end.date : Temporal.PlainDate.from(e.start.date).add({ days: 1 }).toString();
    return { ...base, allDay: true, startsAt: null, endsAt: null, startDate: e.start.date, endDate: end };
  }
  if (!e.start.dateTime) return null;
  const startsAt = Temporal.Instant.from(e.start.dateTime);
  const endsAt = e.end?.dateTime ? Temporal.Instant.from(e.end.dateTime) : null;
  return {
    ...base,
    allDay: false,
    startsAt,
    endsAt: endsAt && Temporal.Instant.compare(endsAt, startsAt) >= 0 ? endsAt : startsAt,
    startDate: null,
    endDate: null,
  };
}

/**
 * Stores one source's events for the window: upserts what changed (by fingerprint), deletes stored instances in the
 * window that didn't come back (deleted or cancelled upstream). Linked reminders follow a moved event.
 */
export async function applyIncoming(
  db: DbLike,
  sourceId: string,
  incoming: Incoming[],
  window: { from: Temporal.Instant; to: Temporal.Instant },
  now: Temporal.Instant,
  tz: string,
) {
  const stored = await db.select().from(externalEvent).where(eq(externalEvent.sourceId, sourceId));
  const byId = new Map(stored.map((r) => [r.externalId, r]));
  const seen = new Set<string>();
  let upserted = 0;

  for (const e of incoming) {
    if (seen.has(e.externalId)) continue;
    seen.add(e.externalId);
    const etag = fingerprint(e);
    const prev = byId.get(e.externalId);
    if (prev?.etag === etag) continue;
    const values = {
      sourceId,
      externalId: e.externalId,
      etag,
      title: e.title,
      location: e.location,
      allDay: e.allDay,
      startsAt: e.startsAt ? toDate(e.startsAt) : null,
      endsAt: e.endsAt ? toDate(e.endsAt) : null,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      htmlLink: e.htmlLink,
      updatedRemoteAt: e.updatedRemoteAt ? toDate(e.updatedRemoteAt) : null,
      syncedAt: toDate(now),
    };
    const [row] = await db
      .insert(externalEvent)
      .values(values)
      .onConflictDoUpdate({ target: [externalEvent.sourceId, externalEvent.externalId], set: values })
      .returning();
    upserted++;
    if (prev && row) await followEvent(db, row, now);
  }

  const gone = stored.filter(
    (r) =>
      !seen.has(r.externalId) &&
      overlaps(span({ ...r, startsAt: r.startsAt && fromDate(r.startsAt), endsAt: r.endsAt && fromDate(r.endsAt) }, tz), window),
  );
  if (gone.length)
    await db.delete(externalEvent).where(
      inArray(
        externalEvent.id,
        gone.map((r) => r.id),
      ),
    ); // their reminders cascade
  return { upserted, deleted: gone.length };
}

/**
 * A synced event changed: its pending "N min antes" reminders move with it (or are dropped if the new time already
 * passed, or it became all-day); fixed-time reminders only take the new title.
 */
async function followEvent(db: DbLike, row: Row, now: Temporal.Instant) {
  const linked = await db
    .select()
    .from(reminder)
    .where(and(eq(reminder.externalEventId, row.id), eq(reminder.status, "scheduled"), isNull(reminder.deletedAt)));
  for (const r of linked) {
    if (r.offsetMinutes === null) {
      if (r.title !== row.title) await db.update(reminder).set({ title: row.title, updatedBy: "system" }).where(eq(reminder.id, r.id));
      continue;
    }
    const start = row.startsAt ? fromDate(row.startsAt) : null;
    const fireAt = start?.subtract({ minutes: r.offsetMinutes });
    if (!start || !fireAt || Temporal.Instant.compare(fireAt, now) <= 0) {
      await db
        .update(reminder)
        .set({ status: "cancelled", deletedAt: toDate(now), updatedBy: "system" })
        .where(eq(reminder.id, r.id));
      continue;
    }
    await db
      .update(reminder)
      .set({ title: row.title, fireAt: toDate(fireAt), eventOccurrenceAt: toDate(start), updatedBy: "system" })
      .where(eq(reminder.id, r.id));
  }
}

// ---------- Google ----------

export async function googleRefreshToken(db: DbLike): Promise<string | null> {
  const [c] = await db.select().from(googleCredential).limit(1);
  if (!c || c.invalidAt) return null;
  return open(c.refreshTokenEnc);
}

/** Google said the grant is dead: mark it, tell Lemy once. */
async function markInvalid(db: DbLike, now: Temporal.Instant) {
  const [c] = await db
    .update(googleCredential)
    .set({ invalidAt: toDate(now) })
    .where(isNull(googleCredential.invalidAt))
    .returning({ id: googleCredential.id });
  if (c) {
    log.warn("google credential invalid");
    await sendNotice(db, {
      title: "Google Calendar desconectado",
      body: "Volvé a conectar en Ajustes → Google Calendar.",
      url: "/ajustes/calendario",
      tag: "google-disconnected",
    });
  }
}

/**
 * Keeps calendar_source in step with the account's calendar list: new calendars appear (enabled when Google shows
 * them in its own sidebar), renamed ones update, removed ones go (with their events).
 */
export async function refreshGoogleCalendars(db: DbLike, refreshToken: string) {
  const calendars = await listCalendars(refreshToken);
  const existing = await db.select().from(calendarSource).where(eq(calendarSource.kind, "google"));
  const ids = new Set(calendars.map((c) => c.id));
  for (const c of calendars) {
    await db
      .insert(calendarSource)
      .values({ kind: "google", externalCalendarId: c.id, name: c.name, color: c.color, enabled: c.selected || c.primary })
      .onConflictDoUpdate({ target: [calendarSource.kind, calendarSource.externalCalendarId], set: { name: c.name, color: c.color } });
  }
  const removed = existing.filter((s) => !ids.has(s.externalCalendarId)).map((s) => s.id);
  if (removed.length) await db.delete(calendarSource).where(inArray(calendarSource.id, removed));
  return calendars;
}

const message = (err: unknown) =>
  err instanceof GoogleError || err instanceof IcalError ? err.message : "Error inesperado al sincronizar.";

function due(s: Source, now: Temporal.Instant, force: boolean) {
  if (force) return true;
  const b = backoff.get(s.id);
  if (b && b.until > now.epochMilliseconds) return false;
  if (!s.lastSyncedAt) return true;
  return fromDate(s.lastSyncedAt).until(now).total("minutes") >= INTERVAL_MINUTES[s.kind === "google" ? "google" : "ical"] - 0.25;
}

function failed(s: Source, now: Temporal.Instant) {
  const failures = (backoff.get(s.id)?.failures ?? 0) + 1;
  const minutes = Math.min(BACKOFF_BASE_MINUTES * 2 ** (failures - 1), BACKOFF_MAX_MINUTES);
  backoff.set(s.id, { failures, until: now.add({ minutes }).epochMilliseconds });
}

let running: Promise<SyncReport> | null = null;

/**
 * Syncs every enabled source that is due (or all of them with `force`, the "Sincronizar" button). Never runs twice at
 * once: a second caller waits for the running pass. Network calls happen outside any request transaction.
 */
export function syncCalendars(db: DbLike, now: Temporal.Instant, opts: { force?: boolean } = {}): Promise<SyncReport> {
  running ??= runSync(db, now, opts.force ?? false).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(db: DbLike, now: Temporal.Instant, force: boolean): Promise<SyncReport> {
  const report: SyncReport = { synced: 0, failed: 0, skipped: 0, upserted: 0, deleted: 0 };
  const tz = (await getSettings(db)).timezone;
  const window = windowAround(now);

  let refreshToken: string | null = null;
  try {
    refreshToken = await googleRefreshToken(db);
    if (
      refreshToken &&
      (force || (await db.select().from(calendarSource).where(eq(calendarSource.kind, "google"))).some((s) => due(s, now, false)))
    )
      await refreshGoogleCalendars(db, refreshToken);
  } catch (err) {
    if (err instanceof GoogleError && err.kind === "invalid_grant") {
      await markInvalid(db, now);
      refreshToken = null;
    } else log.warn("google calendar list failed", { error: message(err) });
  }

  const sources = await db.select().from(calendarSource).where(eq(calendarSource.enabled, true));
  for (const s of sources) {
    if ((s.kind === "google" && !refreshToken) || !due(s, now, force)) {
      report.skipped++;
      continue;
    }
    try {
      let incoming: Incoming[];
      if (s.kind === "google") {
        const events = await listEvents(refreshToken as string, s.externalCalendarId, window.from, window.to);
        incoming = events.map(fromGoogle).filter((e): e is Incoming => e !== null);
      } else {
        if (!s.icalUrlEnc) continue;
        incoming = parseIcal(await fetchIcal(open(s.icalUrlEnc)), window.from, window.to);
      }
      const r = await applyIncoming(db, s.id, incoming, window, now, tz);
      await db
        .update(calendarSource)
        .set({ lastSyncedAt: toDate(now), lastError: null })
        .where(eq(calendarSource.id, s.id));
      backoff.delete(s.id);
      report.synced++;
      report.upserted += r.upserted;
      report.deleted += r.deleted;
    } catch (err) {
      report.failed++;
      failed(s, now);
      if (err instanceof GoogleError && err.kind === "invalid_grant") {
        await markInvalid(db, now);
        refreshToken = null;
      }
      await db
        .update(calendarSource)
        .set({ lastError: message(err) })
        .where(eq(calendarSource.id, s.id));
      if (!(err instanceof GoogleError || err instanceof IcalError)) log.error("calendar sync failed", { source: s.id, err });
    }
  }
  // a new or moved event may need its calendar's automatic reminder before the next 5-minute pass
  if (report.upserted) await materializeEventReminders(db, now);
  if (report.upserted || report.deleted || report.failed) log.info("calendars synced", { ...report });
  return report;
}

/** Disconnecting: the credential and every Google calendar (events and their reminders cascade). */
export async function forgetGoogle(db: DbLike) {
  await db.delete(calendarSource).where(eq(calendarSource.kind, "google"));
  await db.delete(googleCredential);
  backoff.clear();
}

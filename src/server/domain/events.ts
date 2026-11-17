import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { one } from "../db/one";
import { calendarSource, event, externalEvent } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, notFound, validation, versionConflict } from "../http/errors";
import { diffFields, recordChange } from "./changes";
import { clearEventReminders, materializeEventReminders } from "./event-reminders";
import { eventUrl } from "./links";
import { eventOccurrences, normalizeEventRrule } from "./recurrence";
import {
  addDays,
  dateText,
  daysBetween,
  formatInstant,
  fromDate,
  type IsoDate,
  instantText,
  localInstant,
  timeOf,
  toDate,
  toInstant,
  yearNow,
} from "./time";

type Row = typeof event.$inferSelect;
type ExtRow = typeof externalEvent.$inferSelect;
type SourceRow = typeof calendarSource.$inferSelect;

/** "jueves 14 de noviembre, 10:00–11:00", "sábado 16 de noviembre (todo el día)". */
export function eventWhen(
  e: {
    allDay: boolean;
    startsAt: Temporal.Instant | Date | null;
    endsAt: Temporal.Instant | Date | null;
    startDate: IsoDate | null;
    endDate: IsoDate | null;
  },
  tz: string,
): string | null {
  const year = yearNow(tz);
  if (e.allDay) {
    if (!e.startDate) return null;
    const last = e.endDate ? addDays(e.endDate, -1) : e.startDate;
    return last > e.startDate
      ? `del ${dateText(e.startDate, year)} al ${dateText(last, year)} (todo el día)`
      : `${dateText(e.startDate, year)} (todo el día)`;
  }
  if (!e.startsAt) return null;
  const start = e.startsAt instanceof Date ? fromDate(e.startsAt) : e.startsAt;
  const text = instantText(start, tz, year);
  if (!e.endsAt) return text;
  const end = e.endsAt instanceof Date ? fromDate(e.endsAt) : e.endsAt;
  return instantText(end, tz, year).startsWith(text.slice(0, text.lastIndexOf(",")))
    ? `${text}–${timeOf(end, tz)}`
    : `${text} → ${instantText(end, tz, year)}`;
}

export function eventOut(r: Row, ctx: Pick<Ctx, "tz">) {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    location: r.location,
    allDay: r.allDay,
    startsAt: r.startsAt ? formatInstant(r.startsAt, ctx.tz) : null,
    endsAt: r.endsAt ? formatInstant(r.endsAt, ctx.tz) : null,
    startDate: r.startDate,
    endDate: r.endDate,
    whenText: eventWhen(r, ctx.tz),
    timezone: r.timezone,
    rrule: r.rrule,
    reminderOffsets: r.reminderOffsets,
    source: r.source,
    url: eventUrl(r.id),
    version: r.version,
    createdAt: formatInstant(r.createdAt, ctx.tz),
    updatedAt: formatInstant(r.updatedAt, ctx.tz),
    updatedBy: r.updatedBy,
  };
}

export type EventOut = ReturnType<typeof eventOut>;

const readOnly = () => new ApiError(409, "READ_ONLY_EVENT");

/** A local event. An external event's id gets READ_ONLY_EVENT (writes) so a caller knows why. */
async function find(ctx: Ctx, id: string, opts: { lock?: boolean; write?: boolean } = {}): Promise<Row> {
  const q = ctx.db
    .select()
    .from(event)
    .where(and(eq(event.id, id), isNull(event.deletedAt)));
  const [r] = opts.lock ? await q.for("update") : await q;
  if (r) return r;
  if (opts.write) {
    const [ext] = await ctx.db.select({ id: externalEvent.id }).from(externalEvent).where(eq(externalEvent.id, id));
    if (ext) throw readOnly();
  }
  throw notFound("No encontré ese evento. Usá listEvents o searchAgenda para buscarlo.");
}

export const getEvent = async (ctx: Ctx, id: string) => eventOut(await find(ctx, id), ctx);

// ---------- times ----------

interface Times {
  allDay: boolean;
  startsAt: Temporal.Instant | null;
  endsAt: Temporal.Instant | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
}

const field = (path: string, message: string, text: string) => new ApiError(400, "VALIDATION_ERROR", text, { fields: [{ path, message }] });

/** Checks a timed XOR all-day combination and fills the defaults (all-day end = the next day). */
function checkTimes(t: Times): Times {
  if (t.allDay) {
    if (!t.startDate) throw field("/startDate", "Required for all-day events", "Un evento de todo el día necesita startDate.");
    const endDate = t.endDate ?? addDays(t.startDate, 1);
    if (endDate <= t.startDate)
      throw field("/endDate", "Must be after startDate (exclusive end)", "endDate es exclusivo: tiene que ser posterior a startDate.");
    if (daysBetween(t.startDate, endDate) > 366) throw field("/endDate", "At most a year", "Un evento puede durar como mucho un año.");
    return { allDay: true, startDate: t.startDate, endDate, startsAt: null, endsAt: null };
  }
  if (!t.startsAt) throw field("/startsAt", "Required for timed events", "Un evento con horario necesita startsAt.");
  if (t.endsAt && Temporal.Instant.compare(t.endsAt, t.startsAt) < 0)
    throw field("/endsAt", "Must not be before startsAt", "El evento no puede terminar antes de empezar.");
  if (t.endsAt && t.startsAt.until(t.endsAt).total("hours") > 366 * 24)
    throw field("/endsAt", "At most a year", "Un evento puede durar como mucho un año.");
  return { allDay: false, startsAt: t.startsAt, endsAt: t.endsAt, startDate: null, endDate: null };
}

const dtstartOf = (t: Times, tz: string): Temporal.ZonedDateTime =>
  t.allDay && t.startDate
    ? Temporal.PlainDate.from(t.startDate).toZonedDateTime({ timeZone: tz })
    : (t.startsAt as Temporal.Instant).toZonedDateTimeISO(tz);

const offsets = (o: number[] | undefined) => (o ? [...new Set(o)].sort((a, b) => b - a) : undefined);

const instant = (s: string | null | undefined, tz: string) => (s ? localInstant(s, tz) : null);

// ---------- writes ----------

export interface EventCreate {
  id?: string;
  title: string;
  notes?: string;
  location?: string;
  allDay?: boolean;
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
  rrule?: string;
  reminderOffsets?: number[];
  clientId?: string;
}

/** Same clientId again: update what was sent and differs, never a duplicate. */
async function upsertByClientId(ctx: Ctx, existing: Row, input: EventCreate): Promise<{ created: false; event: EventOut }> {
  if (existing.deletedAt)
    throw new ApiError(409, "CONFLICT", `El clientId "${existing.clientId}" ya se usó para un evento que se borró. Usá otro clientId.`);
  const same = (a: string | undefined, b: Date | null) => a === undefined || (b !== null && localInstant(a, ctx.tz).equals(fromDate(b)));
  const patch: EventPatch = {};
  if (input.title !== existing.title) patch.title = input.title;
  if (input.notes !== undefined && (input.notes.trim() || null) !== existing.notes) patch.notes = input.notes;
  if (input.location !== undefined && (input.location.trim() || null) !== existing.location) patch.location = input.location;
  const allDay = input.allDay ?? existing.allDay;
  if (allDay !== existing.allDay) patch.allDay = allDay;
  if (allDay) {
    if (input.startDate !== undefined && input.startDate !== existing.startDate) patch.startDate = input.startDate;
    if (input.endDate !== undefined && input.endDate !== existing.endDate) patch.endDate = input.endDate;
  } else {
    if (!same(input.startsAt, existing.startsAt)) patch.startsAt = input.startsAt ?? null;
    if (!same(input.endsAt, existing.endsAt)) patch.endsAt = input.endsAt ?? null;
  }
  if (input.rrule !== undefined && input.rrule !== existing.rrule) patch.rrule = input.rrule;
  const offs = offsets(input.reminderOffsets);
  if (offs && offs.join() !== existing.reminderOffsets.join()) patch.reminderOffsets = offs;
  const out = Object.keys(patch).length ? await updateEvent(ctx, existing.id, patch) : eventOut(existing, ctx);
  return { created: false, event: out };
}

export async function createEvent(ctx: Ctx, input: EventCreate): Promise<{ created: boolean; event: EventOut }> {
  if (input.clientId) {
    const [existing] = await ctx.db.select().from(event).where(eq(event.clientId, input.clientId)).for("update");
    if (existing) return upsertByClientId(ctx, existing, input);
  }
  const allDay = input.allDay ?? false;
  if (allDay && (input.startsAt || input.endsAt))
    throw validation([{ path: "/startsAt", message: "All-day events use startDate/endDate, not startsAt/endsAt" }]);
  if (!allDay && (input.startDate || input.endDate))
    throw validation([{ path: "/startDate", message: "Timed events use startsAt/endsAt; set allDay: true for dates" }]);
  const t = checkTimes({
    allDay,
    startsAt: instant(input.startsAt, ctx.tz),
    endsAt: instant(input.endsAt, ctx.tz),
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
  });
  const source = sourceOf(ctx.caller);
  const row = one(
    await ctx.db
      .insert(event)
      .values({
        ...(input.id ? { id: input.id } : {}),
        title: input.title,
        notes: input.notes?.trim() || null,
        location: input.location?.trim() || null,
        allDay: t.allDay,
        startsAt: t.startsAt ? toDate(t.startsAt) : null,
        endsAt: t.endsAt ? toDate(t.endsAt) : null,
        startDate: t.startDate,
        endDate: t.endDate,
        timezone: ctx.tz,
        rrule: input.rrule ? normalizeEventRrule(input.rrule, dtstartOf(t, ctx.tz)) : null,
        reminderOffsets: offsets(input.reminderOffsets) ?? [],
        clientId: input.clientId ?? null,
        source,
        updatedBy: source,
      })
      .returning(),
    "event insert",
  );
  await recordChange(ctx, "event", row.id, "create");
  await materializeEventReminders(ctx.db, ctx.now, { eventId: row.id });
  return { created: true, event: eventOut(row, ctx) };
}

export interface EventPatch {
  title?: string;
  notes?: string | null;
  location?: string | null;
  allDay?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  rrule?: string | null;
  reminderOffsets?: number[];
  version?: number;
}

/** The patched times: moving the start keeps the duration unless the end is given too; switching kinds converts. */
function patchedTimes(r: Row, b: EventPatch, tz: string): Times {
  const allDay = b.allDay ?? r.allDay;
  if (allDay) {
    const startDate =
      b.startDate !== undefined
        ? b.startDate
        : r.allDay
          ? r.startDate
          : r.startsAt
            ? fromDate(r.startsAt).toZonedDateTimeISO(tz).toPlainDate().toString()
            : null;
    let endDate = b.endDate !== undefined ? b.endDate : null;
    if (b.endDate === undefined && r.allDay && r.startDate && r.endDate && startDate)
      endDate = addDays(startDate, daysBetween(r.startDate, r.endDate));
    return checkTimes({ allDay, startDate, endDate, startsAt: null, endsAt: null });
  }
  const startsAt = b.startsAt !== undefined ? instant(b.startsAt, tz) : r.allDay ? null : r.startsAt && fromDate(r.startsAt);
  let endsAt = b.endsAt !== undefined ? instant(b.endsAt, tz) : null;
  if (b.endsAt === undefined && !r.allDay && r.startsAt && r.endsAt && startsAt)
    endsAt = startsAt.add({ milliseconds: r.endsAt.getTime() - r.startsAt.getTime() });
  if (b.endsAt === undefined && r.allDay && startsAt) endsAt = startsAt.add({ hours: 1 });
  return checkTimes({ allDay, startsAt, endsAt, startDate: null, endDate: null });
}

export async function updateEvent(ctx: Ctx, id: string, b: EventPatch) {
  const r = await find(ctx, id, { lock: true, write: true });
  const expected = b.version ?? ctx.ifMatch;
  if (expected != null && expected !== r.version) throw versionConflict(eventOut(r, ctx));
  const t = patchedTimes(r, b, r.timezone);
  const rrule = b.rrule !== undefined ? b.rrule : r.rrule;
  const row = one(
    await ctx.db
      .update(event)
      .set({
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.notes !== undefined ? { notes: b.notes?.trim() || null } : {}),
        ...(b.location !== undefined ? { location: b.location?.trim() || null } : {}),
        allDay: t.allDay,
        startsAt: t.startsAt ? toDate(t.startsAt) : null,
        endsAt: t.endsAt ? toDate(t.endsAt) : null,
        startDate: t.startDate,
        endDate: t.endDate,
        rrule: rrule ? normalizeEventRrule(rrule, dtstartOf(t, r.timezone)) : null,
        ...(b.reminderOffsets !== undefined ? { reminderOffsets: offsets(b.reminderOffsets) ?? [] } : {}),
        updatedBy: sourceOf(ctx.caller),
      })
      .where(eq(event.id, id))
      .returning(),
    "event update",
  );
  await recordChange(ctx, "event", id, "update", { fields: diffFields(r, row) });
  // pending "N min antes" reminders follow the new times/offsets
  await clearEventReminders(ctx.db, { eventId: id });
  await materializeEventReminders(ctx.db, ctx.now, { eventId: id });
  return eventOut(row, ctx);
}

export async function deleteEvent(ctx: Ctx, id: string) {
  await find(ctx, id, { lock: true, write: true });
  await ctx.db
    .update(event)
    .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(event.id, id));
  await clearEventReminders(ctx.db, { eventId: id });
  await recordChange(ctx, "event", id, "delete");
}

// ---------- reading a range ----------

export interface AgendaEventOut {
  id: string;
  eventId: string | null;
  externalEventId: string | null;
  source: "local" | "google" | "ical";
  readOnly: boolean;
  title: string;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  whenText: string | null;
  recurring: boolean;
  rrule: string | null;
  reminderOffsets: number[];
  tentative: boolean;
  htmlLink: string | null;
  calendar: { id: string; name: string; color: string | null } | null;
  url: string;
}

/** Fills whenText/url once the occurrence's times are known. */
function finish(o: Omit<AgendaEventOut, "whenText" | "url">, tz: string): AgendaEventOut {
  const at = (s: string | null) => (s ? Temporal.Instant.from(s) : null);
  return {
    ...o,
    whenText: eventWhen(
      { allDay: o.allDay, startsAt: at(o.startsAt), endsAt: at(o.endsAt), startDate: o.startDate, endDate: o.endDate },
      tz,
    ),
    url: eventUrl(o.eventId ?? o.id),
  };
}

/** [from 00:00, to + 1 00:00) in the user's timezone. */
export const rangeOf = (from: IsoDate, to: IsoDate, tz: string) => ({
  start: toInstant(from, null, tz),
  end: toInstant(addDays(to, 1), null, tz),
});

function occurrence(r: Row, start: Temporal.ZonedDateTime | null, ctx: Pick<Ctx, "tz">): AgendaEventOut {
  return finish(occurrenceTimes(r, start, ctx), ctx.tz);
}

function occurrenceTimes(r: Row, start: Temporal.ZonedDateTime | null, ctx: Pick<Ctx, "tz">): Omit<AgendaEventOut, "whenText" | "url"> {
  const base = {
    eventId: r.id,
    externalEventId: null,
    source: "local" as const,
    readOnly: false,
    title: r.title,
    notes: r.notes,
    location: r.location,
    allDay: r.allDay,
    recurring: r.rrule !== null,
    rrule: r.rrule,
    reminderOffsets: r.reminderOffsets,
    tentative: false,
    htmlLink: null,
    calendar: null,
  };
  if (!start)
    return {
      ...base,
      id: r.id,
      startsAt: r.startsAt ? formatInstant(r.startsAt, ctx.tz) : null,
      endsAt: r.endsAt ? formatInstant(r.endsAt, ctx.tz) : null,
      startDate: r.startDate,
      endDate: r.endDate,
    };
  if (r.allDay && r.startDate && r.endDate) {
    const startDate = start.toPlainDate().toString();
    return {
      ...base,
      id: `${r.id}@${startDate}`,
      startsAt: null,
      endsAt: null,
      startDate,
      endDate: addDays(startDate, daysBetween(r.startDate, r.endDate)),
    };
  }
  const s = start.toInstant();
  const length = r.startsAt && r.endsAt ? r.endsAt.getTime() - r.startsAt.getTime() : null;
  return {
    ...base,
    id: `${r.id}@${s.epochMilliseconds}`,
    startsAt: formatInstant(s, ctx.tz),
    endsAt: length === null ? null : formatInstant(s.add({ milliseconds: length }), ctx.tz),
    startDate: null,
    endDate: null,
  };
}

function externalOut(e: ExtRow, s: SourceRow, ctx: Pick<Ctx, "tz">): AgendaEventOut {
  return finish(externalTimes(e, s, ctx), ctx.tz);
}

function externalTimes(e: ExtRow, s: SourceRow, ctx: Pick<Ctx, "tz">): Omit<AgendaEventOut, "whenText" | "url"> {
  return {
    id: e.id,
    eventId: null,
    externalEventId: e.id,
    source: s.kind === "ical" ? "ical" : "google",
    readOnly: true,
    title: e.title,
    notes: null,
    location: e.location,
    allDay: e.allDay,
    startsAt: e.startsAt ? formatInstant(e.startsAt, ctx.tz) : null,
    endsAt: e.endsAt ? formatInstant(e.endsAt, ctx.tz) : null,
    startDate: e.startDate,
    endDate: e.allDay ? (e.endDate ?? (e.startDate ? addDays(e.startDate, 1) : null)) : null,
    recurring: false,
    rrule: null,
    reminderOffsets: [],
    tentative: e.status === "tentative",
    htmlLink: e.htmlLink,
    calendar: { id: s.id, name: s.name, color: s.color },
  };
}

/** Sort key: all-day events first on their day, then by start. */
function sortKey(e: AgendaEventOut, tz: string): string {
  if (e.allDay && e.startDate) return `${e.startDate} 0`;
  const z = Temporal.Instant.from(e.startsAt as string).toZonedDateTimeISO(tz);
  return `${z.toPlainDate()} 1 ${z.toPlainTime()}`;
}

/** Local events (recurring ones expanded) and, optionally, enabled Google/iCal ones, overlapping [from, to]. */
export async function eventsBetween(ctx: Ctx, from: IsoDate, to: IsoDate, includeExternal = true): Promise<AgendaEventOut[]> {
  const { start, end } = rangeOf(from, to, ctx.tz);
  const dayAfter = addDays(to, 1);
  const overlapsTimed = (s: typeof event.startsAt | typeof externalEvent.startsAt, e: typeof event.endsAt | typeof externalEvent.endsAt) =>
    and(lt(s, toDate(end)), sql`coalesce(${e}, ${s}) >= ${toDate(start).toISOString()}::timestamptz`);

  const local = await ctx.db
    .select()
    .from(event)
    .where(
      and(
        isNull(event.deletedAt),
        or(
          isNotNull(event.rrule), // expanded below
          and(eq(event.allDay, false), overlapsTimed(event.startsAt, event.endsAt)),
          and(eq(event.allDay, true), lt(event.startDate, dayAfter), gt(event.endDate, from)),
        ),
      ),
    );

  const out: AgendaEventOut[] = [];
  for (const r of local) {
    if (!r.rrule) {
      out.push(occurrence(r, null, ctx));
      continue;
    }
    const allDay = r.allDay && r.startDate && r.endDate;
    const dtstart = allDay
      ? Temporal.PlainDate.from(r.startDate as string).toZonedDateTime({ timeZone: r.timezone })
      : fromDate(r.startsAt as Date).toZonedDateTimeISO(r.timezone);
    const duration = allDay
      ? daysBetween(r.startDate as string, r.endDate as string) * 86_400_000
      : r.endsAt && r.startsAt
        ? r.endsAt.getTime() - r.startsAt.getTime()
        : 0;
    for (const z of eventOccurrences(r.rrule, dtstart, duration, start, end)) out.push(occurrence(r, z, ctx));
  }

  if (includeExternal) {
    const ext = await ctx.db
      .select({ e: externalEvent, s: calendarSource })
      .from(externalEvent)
      .innerJoin(calendarSource, eq(calendarSource.id, externalEvent.sourceId))
      .where(
        and(
          eq(calendarSource.enabled, true),
          or(
            and(eq(externalEvent.allDay, false), overlapsTimed(externalEvent.startsAt, externalEvent.endsAt)),
            and(
              eq(externalEvent.allDay, true),
              lt(externalEvent.startDate, dayAfter),
              sql`coalesce(${externalEvent.endDate}, ${externalEvent.startDate} + 1) > ${from}::date`,
            ),
          ),
        ),
      )
      .orderBy(asc(externalEvent.startsAt));
    for (const { e, s } of ext) out.push(externalOut(e, s, ctx));
  }

  return out.sort((a, b) => {
    const ka = sortKey(a, ctx.tz);
    const kb = sortKey(b, ctx.tz);
    return ka < kb ? -1 : ka > kb ? 1 : a.title.localeCompare(b.title, "es");
  });
}

export async function listEvents(ctx: Ctx, q: { from: IsoDate; to: IsoDate; includeExternal?: "true" | "false" }) {
  if (q.to < q.from) throw validation([{ path: "query/to", message: "Must not be before from" }]);
  if (daysBetween(q.from, q.to) > 92) throw validation([{ path: "query/to", message: "At most 92 days after from" }]);
  return eventsBetween(ctx, q.from, q.to, q.includeExternal !== "false");
}

// ---------- overlaps ----------

/** The search window for an overlap check is capped: a months-long event only checks its first month. */
const OVERLAP_MAX_DAYS = 31;

/** [s, e) and [os, oe) overlap; a zero-length span is a point (it overlaps what contains it or starts with it). */
const overlaps = (s: Temporal.Instant, e: Temporal.Instant, os: Temporal.Instant, oe: Temporal.Instant) =>
  (Temporal.Instant.compare(s, oe) < 0 && Temporal.Instant.compare(os, e) < 0) || s.equals(os);

const dayOf = (i: Temporal.Instant, tz: string) => i.toZonedDateTimeISO(tz).toPlainDate().toString();

/** Timed occurrences of `list` overlapping [start, end), skipping the event being saved. All-day events never count. */
function timedOverlapping(list: AgendaEventOut[], start: Temporal.Instant, end: Temporal.Instant, excludeEventId?: string | null) {
  return list.filter((o) => {
    if (o.allDay || !o.startsAt) return false;
    if (excludeEventId && o.eventId === excludeEventId) return false;
    const os = Temporal.Instant.from(o.startsAt);
    return overlaps(start, end, os, o.endsAt ? Temporal.Instant.from(o.endsAt) : os);
  });
}

/**
 * Timed events (Lemy's own, recurring ones expanded, and enabled Google/iCal calendars) that overlap [start, end), or
 * the moment `start` when there's no end. Never blocks a write: callers return it as `conflicts` so Sunday or the
 * app can warn.
 */
export async function overlapping(ctx: Ctx, start: Temporal.Instant, end: Temporal.Instant | null, excludeEventId?: string | null) {
  const cap = start.add({ hours: OVERLAP_MAX_DAYS * 24 });
  const e = end === null ? start : Temporal.Instant.compare(end, cap) > 0 ? cap : end;
  const list = await eventsBetween(ctx, dayOf(start, ctx.tz), dayOf(e, ctx.tz));
  return timedOverlapping(list, start, e, excludeEventId);
}

/** What a saved local event overlaps (its first occurrence if it repeats); all-day events have none. */
export async function conflictsOf(ctx: Ctx, ev: Pick<EventOut, "id" | "allDay" | "startsAt" | "endsAt">) {
  if (ev.allDay || !ev.startsAt) return [];
  return overlapping(ctx, Temporal.Instant.from(ev.startsAt), ev.endsAt ? Temporal.Instant.from(ev.endsAt) : null, ev.id);
}

/** checkAvailability: what's booked between two moments (timed events) plus the all-day events of those days. */
export async function availability(ctx: Ctx, q: { from: string; to: string }) {
  const start = localInstant(q.from, ctx.tz);
  const end = localInstant(q.to, ctx.tz);
  if (Temporal.Instant.compare(end, start) <= 0) throw validation([{ path: "query/to", message: "Must be after from" }]);
  if (start.until(end).total("hours") > OVERLAP_MAX_DAYS * 24)
    throw validation([{ path: "query/to", message: `At most ${OVERLAP_MAX_DAYS} days after from` }]);
  // the end is exclusive: a range ending at 00:00 doesn't reach into that day
  const list = await eventsBetween(ctx, dayOf(start, ctx.tz), dayOf(end.subtract({ milliseconds: 1 }), ctx.tz));
  const busy = timedOverlapping(list, start, end);
  return {
    from: formatInstant(start, ctx.tz),
    to: formatInstant(end, ctx.tz),
    free: busy.length === 0,
    busy,
    allDay: list.filter((o) => o.allDay),
  };
}

/** Local events matching text, for searchAgenda (Google ones are found in Google). */
export async function searchEvents(ctx: Ctx, q: string, limit = 20) {
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const where: SQL[] = [
    isNull(event.deletedAt),
    sql`f_search(${event.title}, ${event.notes}, ${event.location}) LIKE '%' || f_search(${esc}::text) || '%' ESCAPE '\\'`,
  ];
  const rows = await ctx.db
    .select()
    .from(event)
    .where(and(...where))
    .orderBy(desc(sql`coalesce(${event.startsAt}, ${event.startDate}::timestamptz)`))
    .limit(limit);
  return rows.map((r) => eventOut(r, ctx));
}

/** An external event by id with its calendar (Recordarme). */
export async function findExternal(ctx: Ctx, id: string) {
  const [hit] = await ctx.db
    .select({ e: externalEvent, s: calendarSource })
    .from(externalEvent)
    .innerJoin(calendarSource, eq(calendarSource.id, externalEvent.sourceId))
    .where(eq(externalEvent.id, id));
  if (!hit) throw notFound("No encontré ese evento de Google Calendar. Usá listEvents para obtener su externalEventId.");
  return hit;
}

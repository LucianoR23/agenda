import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL, sql } from "drizzle-orm";
import { one } from "../db/one";
import { reminder, reminderDelivery, task } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, notFound, versionConflict } from "../http/errors";
import { diffFields, recordChange } from "./changes";
import { reminderUrl } from "./links";
import { normalizeReminderRrule } from "./recurrence";
import { getSettings } from "./settings";
import { completeTask } from "./tasks";
import { formatInstant, fromDate, instantText, localInstant, toDate, yearNow } from "./time";

type Row = typeof reminder.$inferSelect;

export function reminderOut(r: Row, ctx: Pick<Ctx, "tz">) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    fireAt: formatInstant(r.fireAt, ctx.tz),
    whenText: instantText(r.fireAt, ctx.tz, yearNow(ctx.tz)),
    rrule: r.rrule,
    status: r.status,
    urgent: r.urgent,
    taskId: r.taskId,
    eventId: r.eventId,
    externalEventId: r.externalEventId,
    snoozedFrom: r.snoozedFrom ? formatInstant(r.snoozedFrom, ctx.tz) : null,
    lastFiredAt: r.lastFiredAt ? formatInstant(r.lastFiredAt, ctx.tz) : null,
    source: r.source,
    url: reminderUrl(r.id),
    version: r.version,
    createdAt: formatInstant(r.createdAt, ctx.tz),
    updatedAt: formatInstant(r.updatedAt, ctx.tz),
    updatedBy: r.updatedBy,
  };
}

export type ReminderOut = ReturnType<typeof reminderOut>;

async function find(ctx: Ctx, id: string, lock = false): Promise<Row> {
  const q = ctx.db
    .select()
    .from(reminder)
    .where(and(eq(reminder.id, id), isNull(reminder.deletedAt)));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw notFound("No encontré ese recordatorio. Usá listReminders o searchAgenda para buscarlo.");
  return r;
}

export const getReminder = async (ctx: Ctx, id: string) => reminderOut(await find(ctx, id), ctx);

export interface ReminderQuery {
  view?: "upcoming" | "recent" | "all";
  status?: Row["status"];
  from?: string;
  to?: string;
  limit?: number;
}

/** `upcoming`: scheduled, soonest first. `recent`: sent/done/missed/cancelled, newest first. */
export async function listReminders(ctx: Ctx, q: ReminderQuery) {
  const where: SQL[] = [isNull(reminder.deletedAt)];
  let order: SQL[] = [asc(reminder.fireAt)];
  if (q.view === "upcoming") where.push(eq(reminder.status, "scheduled"));
  if (q.view === "recent") {
    where.push(inArray(reminder.status, ["sent", "done", "missed", "cancelled"]));
    order = [sql`coalesce(${reminder.lastFiredAt}, ${reminder.fireAt}) DESC`];
  }
  if (q.status) where.push(eq(reminder.status, q.status));
  if (q.from) where.push(gte(reminder.fireAt, toDate(Temporal.Instant.from(q.from))));
  if (q.to) where.push(lte(reminder.fireAt, toDate(Temporal.Instant.from(q.to))));
  const rows = await ctx.db
    .select()
    .from(reminder)
    .where(and(...where))
    .orderBy(...order)
    .limit(q.limit ?? 100);
  return rows.map((r) => reminderOut(r, ctx));
}

/** Today's reminders (any status), for Hoy. */
export async function remindersBetween(ctx: Ctx, from: Temporal.Instant, to: Temporal.Instant) {
  const rows = await ctx.db
    .select()
    .from(reminder)
    .where(and(isNull(reminder.deletedAt), gte(reminder.fireAt, toDate(from)), lte(reminder.fireAt, toDate(to))))
    .orderBy(asc(reminder.fireAt));
  return rows.map((r) => reminderOut(r, ctx));
}

async function assertTask(ctx: Ctx, taskId: string | null | undefined) {
  if (!taskId) return;
  const [t] = await ctx.db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), isNull(task.deletedAt)));
  if (!t) throw notFound("No encontré la tarea a la que querés vincular el recordatorio.");
}

/** A fire time in the past (beyond a minute of clock skew) is a mistake, not a "send now". */
function assertFuture(ctx: Ctx, fireAt: Temporal.Instant) {
  if (Temporal.Instant.compare(fireAt, ctx.now.subtract({ minutes: 1 })) < 0)
    throw new ApiError(400, "VALIDATION_ERROR", "Esa hora ya pasó. Elegí un momento futuro.", {
      fields: [{ path: "/fireAt", message: "Must be in the future" }],
    });
}

export interface ReminderCreate {
  id?: string;
  title: string;
  body?: string;
  fireAt: string;
  rrule?: string;
  urgent?: boolean;
  taskId?: string;
  clientId?: string;
}

/** Same clientId again: update what was sent and differs (a new time re-arms it), never a duplicate. */
async function upsertByClientId(ctx: Ctx, existing: Row, input: ReminderCreate): Promise<{ created: false; reminder: ReminderOut }> {
  if (existing.deletedAt)
    throw new ApiError(
      409,
      "CONFLICT",
      `El clientId "${existing.clientId}" ya se usó para un recordatorio que se borró. Usá otro clientId.`,
    );
  const patch: ReminderPatch = {};
  if (input.title !== existing.title) patch.title = input.title;
  if (input.body !== undefined && input.body !== existing.body) patch.body = input.body;
  if (!localInstant(input.fireAt, ctx.tz).equals(fromDate(existing.fireAt))) patch.fireAt = input.fireAt;
  if (input.rrule !== undefined && input.rrule !== existing.rrule) patch.rrule = input.rrule;
  if (input.urgent !== undefined && input.urgent !== existing.urgent) patch.urgent = input.urgent;
  if (input.taskId !== undefined && input.taskId !== existing.taskId) patch.taskId = input.taskId;
  const out = Object.keys(patch).length ? await updateReminder(ctx, existing.id, patch) : reminderOut(existing, ctx);
  return { created: false, reminder: out };
}

export async function createReminder(ctx: Ctx, input: ReminderCreate): Promise<{ created: boolean; reminder: ReminderOut }> {
  if (input.clientId) {
    const [existing] = await ctx.db.select().from(reminder).where(eq(reminder.clientId, input.clientId)).for("update");
    if (existing) return upsertByClientId(ctx, existing, input);
  }
  const fireAt = localInstant(input.fireAt, ctx.tz);
  assertFuture(ctx, fireAt);
  await assertTask(ctx, input.taskId);
  const source = sourceOf(ctx.caller);
  const row = one(
    await ctx.db
      .insert(reminder)
      .values({
        ...(input.id ? { id: input.id } : {}),
        title: input.title,
        body: input.body ?? null,
        fireAt: toDate(fireAt),
        rrule: input.rrule ? normalizeReminderRrule(input.rrule, fireAt, ctx.tz) : null,
        urgent: input.urgent ?? false,
        taskId: input.taskId ?? null,
        clientId: input.clientId ?? null,
        source,
        updatedBy: source,
      })
      .returning(),
    "reminder insert",
  );
  await recordChange(ctx, "reminder", row.id, "create");
  return { created: true, reminder: reminderOut(row, ctx) };
}

export interface ReminderPatch {
  title?: string;
  body?: string | null;
  fireAt?: string;
  rrule?: string | null;
  urgent?: boolean;
  taskId?: string | null;
  version?: number;
}

const assertVersion = (ctx: Ctx, r: Row, v?: number) => {
  const expected = v ?? ctx.ifMatch;
  if (expected != null && expected !== r.version) throw versionConflict(reminderOut(r, ctx));
};

export async function updateReminder(ctx: Ctx, id: string, body: ReminderPatch) {
  const r = await find(ctx, id, true);
  assertVersion(ctx, r, body.version);
  const fireAt = body.fireAt ? localInstant(body.fireAt, ctx.tz) : fromDate(r.fireAt);
  if (body.fireAt) assertFuture(ctx, fireAt);
  if (body.taskId !== undefined) await assertTask(ctx, body.taskId);
  const rrule = body.rrule !== undefined ? body.rrule : r.rrule;
  const patch = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.body !== undefined ? { body: body.body } : {}),
    ...(body.urgent !== undefined ? { urgent: body.urgent } : {}),
    ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
    // a new time re-arms a reminder that already fired, was missed or done
    ...(body.fireAt ? { fireAt: toDate(fireAt), snoozedFrom: null, status: "scheduled" as const } : {}),
    rrule: rrule ? normalizeReminderRrule(rrule, fireAt, ctx.tz) : null,
  };
  const row = one(
    await ctx.db
      .update(reminder)
      .set({ ...patch, updatedBy: sourceOf(ctx.caller) })
      .where(eq(reminder.id, id))
      .returning(),
    "reminder update",
  );
  await recordChange(ctx, "reminder", id, "update", { fields: diffFields(r, row) });
  return reminderOut(row, ctx);
}

/**
 * Postpone by `minutes` (default: the user's snooze setting) or until a time. The original time is kept in
 * `snoozed_from`, so a recurring series continues from it, not from the snoozed time.
 */
export async function snoozeReminder(ctx: Ctx, id: string, body: { minutes?: number; until?: string }) {
  const r = await find(ctx, id, true);
  if (r.status === "cancelled") throw new ApiError(409, "CONFLICT", "Ese recordatorio está cancelado.");
  const until = body.until
    ? localInstant(body.until, ctx.tz)
    : ctx.now.add({ minutes: body.minutes ?? (await getSettings(ctx.db)).defaultSnoozeMinutes });
  if (Temporal.Instant.compare(until, ctx.now) <= 0)
    throw new ApiError(400, "VALIDATION_ERROR", "Posponer necesita un momento futuro.", {
      fields: [{ path: "/until", message: "Must be in the future" }],
    });
  // for a recurring reminder that already fired, the occurrence being snoozed is the one that just went out (its
  // exact scheduled time from the delivery, not the send time, so the series doesn't drift)
  let anchor = r.snoozedFrom ?? r.fireAt;
  if (!r.snoozedFrom && r.rrule) {
    const [last] = await ctx.db
      .select({ at: reminderDelivery.occurrenceAt })
      .from(reminderDelivery)
      .where(eq(reminderDelivery.reminderId, r.id))
      .orderBy(desc(reminderDelivery.occurrenceAt))
      .limit(1);
    if (last && last.at < r.fireAt) anchor = last.at;
  }
  const row = one(
    await ctx.db
      .update(reminder)
      .set({ fireAt: toDate(until), snoozedFrom: anchor, status: "scheduled", updatedBy: sourceOf(ctx.caller) })
      .where(eq(reminder.id, id))
      .returning(),
    "reminder snooze",
  );
  await recordChange(ctx, "reminder", id, "update", { fields: { fireAt: { from: r.fireAt, to: row.fireAt } } });
  return reminderOut(row, ctx);
}

/**
 * "Listo": a one-off reminder is done; a recurring one keeps its schedule (the current occurrence is acknowledged).
 * A linked task is completed too.
 */
export async function doneReminder(ctx: Ctx, id: string) {
  const r = await find(ctx, id, true);
  let row = r;
  if (!r.rrule && r.status !== "done") {
    row = one(
      await ctx.db
        .update(reminder)
        .set({ status: "done", snoozedFrom: null, updatedBy: sourceOf(ctx.caller) })
        .where(eq(reminder.id, id))
        .returning(),
      "reminder done",
    );
    await recordChange(ctx, "reminder", id, "update", { fields: { status: { from: r.status, to: "done" } } });
  }
  if (r.taskId) {
    const [t] = await ctx.db
      .select({ status: task.status })
      .from(task)
      .where(and(eq(task.id, r.taskId), isNull(task.deletedAt)));
    if (t?.status === "open") await completeTask(ctx, r.taskId);
  }
  return reminderOut(row, ctx);
}

/** Cancel (soft delete). A reminder already marked Listo stays: it's history. */
export async function deleteReminder(ctx: Ctx, id: string) {
  const r = await find(ctx, id, true);
  if (r.status === "done") throw new ApiError(409, "CONFLICT", "Ese recordatorio ya está hecho: queda en el historial y no se borra.");
  await ctx.db
    .update(reminder)
    .set({ status: "cancelled", deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(reminder.id, id));
  await recordChange(ctx, "reminder", id, "delete");
}

/** Reminders matching text, for searchAgenda. */
export async function searchReminders(ctx: Ctx, q: string, includeDone: boolean, limit = 20) {
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const where: SQL[] = [
    isNull(reminder.deletedAt),
    sql`f_search(${reminder.title}, ${reminder.body}) LIKE '%' || f_search(${esc}::text) || '%' ESCAPE '\\'`,
  ];
  if (!includeDone) where.push(eq(reminder.status, "scheduled"));
  const rows = await ctx.db
    .select()
    .from(reminder)
    .where(and(...where))
    .orderBy(desc(reminder.fireAt))
    .limit(limit);
  return rows.map((r) => reminderOut(r, ctx));
}

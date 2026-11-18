import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { one } from "../db/one";
import { habit, habitLog, task } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, notFound, versionConflict } from "../http/errors";
import { diffFields, recordChange } from "./changes";
import { type HabitDef, type LogPoint, periodCount, periodEnd, periodMet, periodStart, streaks } from "./streaks";
import { addDays, dateOf, formatInstant, fromDate, type IsoDate, toDate, today, toInstant } from "./time";

type Row = typeof habit.$inferSelect;
type LogRow = typeof habitLog.$inferSelect;

export const userToday = (ctx: Pick<Ctx, "tz" | "now">) => today(ctx.tz, { now: () => ctx.now });

export function habitOut(h: Row, ctx: Pick<Ctx, "tz">) {
  return {
    id: h.id,
    slug: h.slug,
    name: h.name,
    kind: h.kind,
    unit: h.unit,
    targetCount: h.targetCount,
    targetPeriod: h.targetPeriod,
    taskTag: h.taskTag,
    active: h.active,
    sortOrder: h.sortOrder,
    version: h.version,
    createdAt: formatInstant(h.createdAt, ctx.tz),
    updatedAt: formatInstant(h.updatedAt, ctx.tz),
    updatedBy: h.updatedBy,
  };
}

export function habitLogOut(l: LogRow, ctx: Pick<Ctx, "tz">) {
  return {
    id: l.id,
    habitId: l.habitId,
    date: l.date,
    done: l.done,
    value: l.value,
    source: l.source,
    version: l.version,
    createdAt: formatInstant(l.createdAt, ctx.tz),
    updatedAt: formatInstant(l.updatedAt, ctx.tz),
    updatedBy: l.updatedBy,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** By id or slug (Sunday says "gym"). */
async function find(ctx: Ctx, ref: string, lock = false): Promise<Row> {
  const q = ctx.db
    .select()
    .from(habit)
    .where(and(isNull(habit.deletedAt), UUID.test(ref) ? eq(habit.id, ref) : eq(habit.slug, ref.toLowerCase())));
  const [h] = lock ? await q.for("update") : await q;
  if (!h) throw notFound(`No encontré el hábito "${ref}". Usá listHabits para ver los que hay.`);
  return h;
}

const points = (logs: LogRow[]): LogPoint[] => logs.map((l) => ({ date: l.date, done: l.done, value: l.value }));

/** Logs needed for streaks: everything (a single user has a few hundred per habit). */
async function logsOf(ctx: Ctx, ids: string[]) {
  if (!ids.length) return new Map<string, LogRow[]>();
  const rows = await ctx.db
    .select()
    .from(habitLog)
    .where(and(inArray(habitLog.habitId, ids), isNull(habitLog.deletedAt)))
    .orderBy(asc(habitLog.date));
  const out = new Map<string, LogRow[]>();
  for (const r of rows) out.set(r.habitId, [...(out.get(r.habitId) ?? []), r]);
  return out;
}

function progress(h: Row, logs: LogRow[], date: IsoDate, ctx: Pick<Ctx, "tz">) {
  const def: HabitDef = { kind: h.kind, targetCount: h.targetCount, targetPeriod: h.targetPeriod };
  const pts = points(logs);
  const start = periodStart(def, date);
  const s = streaks(def, pts, date);
  const log = logs.find((l) => l.date === date) ?? null;
  return {
    ...habitOut(h, ctx),
    streak: { current: s.current, best: s.best, unit: h.targetPeriod },
    period: {
      start,
      end: periodEnd(def, date),
      count: periodCount(def, pts, start),
      target: h.targetCount,
      met: periodMet(def, pts, start),
    },
    log: log ? habitLogOut(log, ctx) : null,
  };
}

export type HabitProgressOut = ReturnType<typeof progress>;

/** Habits with streaks and the period's progress as of `date` (default today). */
export async function listHabits(ctx: Ctx, q: { date?: IsoDate; includeArchived?: "true" | "false" } = {}) {
  const date = q.date ?? userToday(ctx);
  const rows = await ctx.db
    .select()
    .from(habit)
    .where(and(isNull(habit.deletedAt), ...(q.includeArchived === "true" ? [] : [eq(habit.active, true)])))
    .orderBy(asc(habit.sortOrder), asc(habit.createdAt));
  const logs = await logsOf(
    ctx,
    rows.map((h) => h.id),
  );
  // a log after `date` must not count for "as of date"
  return rows.map((h) =>
    progress(
      h,
      (logs.get(h.id) ?? []).filter((l) => l.date <= date),
      date,
      ctx,
    ),
  );
}

export const getHabit = async (ctx: Ctx, ref: string, date?: IsoDate) => {
  const h = await find(ctx, ref);
  const d = date ?? userToday(ctx);
  return progress(
    h,
    ((await logsOf(ctx, [h.id])).get(h.id) ?? []).filter((l) => l.date <= d),
    d,
    ctx,
  );
};

/** "Lectura diaria" → "lectura-diaria". */
export const slugify = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "habito";

export interface HabitCreate {
  slug?: string;
  name: string;
  kind?: "boolean" | "numeric";
  unit?: string | null;
  targetCount?: number;
  targetPeriod?: "day" | "week";
  taskTag?: string | null;
}

const taken = (what: "slug" | "taskTag", value: string) =>
  new ApiError(
    409,
    "CONFLICT",
    what === "slug" ? `Ya hay un hábito con la clave "${value}". Elegí otra.` : `La etiqueta +${value} ya está asignada a otro hábito.`,
    { fields: [{ path: `/${what}`, message: "Already in use" }] },
  );

async function assertFree(ctx: Ctx, what: "slug" | "taskTag", value: string | null | undefined, except?: string) {
  if (!value) return;
  const [hit] = await ctx.db
    .select({ id: habit.id })
    .from(habit)
    .where(and(isNull(habit.deletedAt), what === "slug" ? eq(habit.slug, value) : eq(habit.taskTag, value)));
  if (hit && hit.id !== except) throw taken(what, value);
}

export async function createHabit(ctx: Ctx, b: HabitCreate) {
  const slug = b.slug ?? slugify(b.name);
  await assertFree(ctx, "slug", slug);
  await assertFree(ctx, "taskTag", b.taskTag);
  const [{ max } = { max: 0 }] = await ctx.db
    .select({ max: sql<number>`coalesce(max(${habit.sortOrder}), 0)::int` })
    .from(habit)
    .where(isNull(habit.deletedAt));
  const source = sourceOf(ctx.caller);
  const row = one(
    await ctx.db
      .insert(habit)
      .values({
        slug,
        name: b.name,
        kind: b.kind ?? "boolean",
        unit: b.unit || null,
        targetCount: b.targetCount ?? 1,
        targetPeriod: b.targetPeriod ?? "day",
        taskTag: b.taskTag ?? null,
        sortOrder: max + 1,
        // the request's clock: history counts a habit from the day it was created
        createdAt: toDate(ctx.now),
        updatedBy: source,
      })
      .returning(),
    "habit insert",
  );
  await recordChange(ctx, "habit", row.id, "create");
  return getHabit(ctx, row.id);
}

export interface HabitPatch {
  name?: string;
  unit?: string | null;
  targetCount?: number;
  targetPeriod?: "day" | "week";
  taskTag?: string | null;
  active?: boolean;
  sortOrder?: number;
  version?: number;
}

export async function updateHabit(ctx: Ctx, ref: string, b: HabitPatch) {
  const h = await find(ctx, ref, true);
  const expected = b.version ?? ctx.ifMatch;
  if (expected != null && expected !== h.version) throw versionConflict(habitOut(h, ctx));
  if (b.unit && h.kind !== "numeric")
    throw new ApiError(400, "VALIDATION_ERROR", "Solo los hábitos numéricos tienen unidad.", {
      fields: [{ path: "/unit", message: "Numeric only" }],
    });
  if (b.taskTag && h.kind !== "boolean")
    throw new ApiError(400, "VALIDATION_ERROR", "Solo los hábitos de sí/no se marcan con una etiqueta de tarea.", {
      fields: [{ path: "/taskTag", message: "Yes/no habits only" }],
    });
  if (b.taskTag) await assertFree(ctx, "taskTag", b.taskTag, h.id);
  const { version: _v, ...patch } = b;
  const row = one(
    await ctx.db
      .update(habit)
      .set({ ...patch, ...(b.unit !== undefined ? { unit: b.unit || null } : {}), updatedBy: sourceOf(ctx.caller) })
      .where(eq(habit.id, h.id))
      .returning(),
    "habit update",
  );
  await recordChange(ctx, "habit", h.id, "update", { fields: diffFields(h, row) });
  return getHabit(ctx, h.id);
}

/**
 * Delete (soft), only for a habit never checked. One with history is archived instead (`active: false`): what was
 * done stays.
 */
export async function deleteHabit(ctx: Ctx, ref: string) {
  const h = await find(ctx, ref, true);
  const [logged] = await ctx.db
    .select({ id: habitLog.id })
    .from(habitLog)
    .where(and(eq(habitLog.habitId, h.id), isNull(habitLog.deletedAt)))
    .limit(1);
  if (logged)
    throw new ApiError(
      409,
      "CONFLICT",
      "Ese hábito ya tiene días cumplidos: no se borra, se archiva (active: false) y su historial queda.",
    );
  await ctx.db
    .update(habit)
    .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(habit.id, h.id));
  await recordChange(ctx, "habit", h.id, "delete");
}

/** Check / uncheck a day (yes/no) or set its value (numeric). Upsert by (habit, date). */
export async function logHabit(ctx: Ctx, ref: string, b: { date?: IsoDate; done?: boolean; value?: number | null }) {
  const h = await find(ctx, ref);
  const date = b.date ?? userToday(ctx);
  if (date > userToday(ctx))
    throw new ApiError(400, "VALIDATION_ERROR", "No se puede marcar un día que todavía no llegó.", {
      fields: [{ path: "/date", message: "Must not be in the future" }],
    });
  if (h.kind === "numeric" && b.value === undefined)
    throw new ApiError(400, "VALIDATION_ERROR", `"${h.name}" es numérico: mandá value (por ejemplo 20).`, {
      fields: [{ path: "/value", message: "Required for numeric habits" }],
    });
  const value = h.kind === "numeric" ? (b.value ?? null) : null;
  const done = h.kind === "numeric" ? (value ?? 0) > 0 : (b.done ?? true);
  await writeLog(ctx, h, date, { done, value }, sourceOf(ctx.caller));
  return getHabit(ctx, h.id, date);
}

async function writeLog(ctx: Ctx, h: Row, date: IsoDate, v: { done: boolean; value: number | null }, source: "user" | "sunday" | "system") {
  const [existing] = await ctx.db
    .select()
    .from(habitLog)
    .where(and(eq(habitLog.habitId, h.id), eq(habitLog.date, date), isNull(habitLog.deletedAt)))
    .for("update");
  // unchecking leaves no row: "not done" and "never logged" are the same thing for streaks
  if (!v.done) {
    if (existing) {
      await ctx.db
        .update(habitLog)
        .set({ deletedAt: toDate(ctx.now), updatedBy: source })
        .where(eq(habitLog.id, existing.id));
      await recordChange(ctx, "habit_log", existing.id, "delete");
    }
    return null;
  }
  if (existing) {
    const row = one(
      await ctx.db.update(habitLog).set({ done: true, value: v.value, updatedBy: source }).where(eq(habitLog.id, existing.id)).returning(),
      "habit log update",
    );
    await recordChange(ctx, "habit_log", row.id, "update", { fields: diffFields(existing, row) });
    return row;
  }
  const row = one(
    await ctx.db.insert(habitLog).values({ habitId: h.id, date, done: true, value: v.value, source, updatedBy: source }).returning(),
    "habit log insert",
  );
  await recordChange(ctx, "habit_log", row.id, "create");
  return row;
}

export async function listHabitLogs(ctx: Ctx, ref: string, q: { from: IsoDate; to: IsoDate }) {
  const h = await find(ctx, ref);
  const rows = await ctx.db
    .select()
    .from(habitLog)
    .where(and(eq(habitLog.habitId, h.id), isNull(habitLog.deletedAt), gte(habitLog.date, q.from), lte(habitLog.date, q.to)))
    .orderBy(asc(habitLog.date));
  return rows.map((l) => habitLogOut(l, ctx));
}

// ---------- tasks that check habits ----------

const lower = (tags: string[]) => tags.map((t) => t.toLowerCase());

async function taggedHabits(ctx: Ctx, tags: string[]) {
  if (!tags.length) return [];
  return ctx.db
    .select()
    .from(habit)
    .where(and(isNull(habit.deletedAt), eq(habit.active, true), eq(habit.kind, "boolean"), inArray(habit.taskTag, lower(tags))));
}

/** A tagged task was completed: check its habits that day (a check that already exists stays as it is). */
export async function onTaskCompleted(ctx: Ctx, t: { tags: string[] }) {
  const date = userToday(ctx);
  for (const h of await taggedHabits(ctx, t.tags)) {
    const [existing] = await ctx.db
      .select({ id: habitLog.id })
      .from(habitLog)
      .where(and(eq(habitLog.habitId, h.id), eq(habitLog.date, date), isNull(habitLog.deletedAt)));
    if (!existing) await writeLog(ctx, h, date, { done: true, value: null }, "system");
  }
}

/**
 * A tagged task was reopened (undo): uncheck what the task checked, unless Lemy checked it himself or another task
 * with the tag is still done that day.
 */
export async function onTaskReopened(ctx: Ctx, t: { id: string; tags: string[]; completedAt: Date | null }) {
  if (!t.completedAt) return;
  const date = dateOf(fromDate(t.completedAt), ctx.tz);
  for (const h of await taggedHabits(ctx, t.tags)) {
    const [log] = await ctx.db
      .select()
      .from(habitLog)
      .where(and(eq(habitLog.habitId, h.id), eq(habitLog.date, date), isNull(habitLog.deletedAt), eq(habitLog.source, "system")));
    if (!log) continue;
    const from = toDate(toInstant(date, null, ctx.tz));
    const to = toDate(toInstant(addDays(date, 1), null, ctx.tz));
    const [other] = await ctx.db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.status, "done"),
          isNull(task.deletedAt),
          sql`${task.id} <> ${t.id}`,
          gte(task.completedAt, from),
          lt(task.completedAt, to),
          sql`exists (select 1 from unnest(${task.tags}) as x(tag) where lower(x.tag) = ${h.taskTag})`,
        ),
      )
      .limit(1);
    const stillDone = Boolean(other);
    if (!stillDone) await writeLog(ctx, h, date, { done: false, value: null }, "system");
  }
}

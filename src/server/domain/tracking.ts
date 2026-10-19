import { and, asc, eq, gte, lte, max } from "drizzle-orm";
import type { z } from "zod";
import type { SleepEvent, SleepUpsert } from "@/contract/sleep";
import type { HabitCreate, HabitLogUpsert, HabitPatch, TaskCreate, TaskPatch } from "@/contract/tracking";
import { block, habit, habitLog, sleepLog, task } from "../db/schema";
import { type Ctx, writer } from "../http/context";
import { dayClosed, forbidden, notFound, userEditConflict, validation, versionConflict } from "../http/errors";
import { addDays, isoLocal, isoLocalOrNull, localDate, sleepNightFor } from "../time";
import { markSleepBlockDone } from "./blocks";
import { diffFields, recordChange } from "./events";
import { findDay, plannedSleep } from "./load";
import type { HabitRow } from "./rows";
import { habitLogOut, sleepOut, taskOut } from "./serialize";
import { periodCount, periodEnd, periodMet, periodStart, streaks, type LogPoint } from "./streaks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkVersion = (expected: number | null | undefined, current: { version: number }, out: () => unknown) => {
  if (expected !== null && expected !== undefined && expected !== current.version) throw versionConflict(expected, out(), current.version);
};

/** Agent writes to a past (closed) day are rejected; mine are allowed. */
const agentPastGuard = (ctx: Ctx, date: string) => {
  if (ctx.caller === "agent" && date < localDate(ctx.now)) throw dayClosed(date);
};

// ---------- habits ----------

export const habitOut = (h: HabitRow) => ({
  id: h.id,
  slug: h.slug,
  name: h.name,
  kind: h.kind,
  unit: h.unit,
  targetCount: h.targetCount,
  targetPeriod: h.targetPeriod,
  blockType: h.blockType,
  active: h.active,
  order: h.order,
  version: h.version,
  createdAt: isoLocal(h.createdAt),
  updatedAt: isoLocal(h.updatedAt),
  updatedBy: h.updatedBy,
});

export async function findHabit(ctx: Ctx, idOrSlug: string, lock = false) {
  const q = ctx.db.select().from(habit).where(UUID.test(idOrSlug) ? eq(habit.id, idOrSlug) : eq(habit.slug, idOrSlug));
  const [h] = lock ? await q.for("update") : await q;
  if (!h) throw notFound("Habit");
  return h;
}

export async function habitLogsOf(ctx: Ctx, habitId: string, from?: string, to?: string) {
  const conds = [eq(habitLog.habitId, habitId)];
  if (from) conds.push(gte(habitLog.date, from));
  if (to) conds.push(lte(habitLog.date, to));
  return ctx.db.select().from(habitLog).where(and(...conds)).orderBy(asc(habitLog.date));
}

export const points = (rows: Array<{ date: string; done: boolean; value: number | string | null }>): LogPoint[] =>
  rows.map((r) => ({ date: r.date, done: r.done, value: r.value === null ? null : Number(r.value) }));

export async function habitProgress(ctx: Ctx, h: HabitRow, today: string) {
  const logs = await habitLogsOf(ctx, h.id);
  const pts = points(logs);
  const s = streaks(h, pts, today);
  const start = periodStart(h, today);
  const todayLog = logs.find((l) => l.date === today);
  return {
    ...habitOut(h),
    streak: { ...s, unit: h.targetPeriod },
    period: { start, end: periodEnd(h, today), count: periodCount(h, pts, start), target: h.targetCount, met: periodMet(h, pts, start) },
    today: todayLog ? habitLogOut(todayLog, h.slug) : null,
  };
}

export async function listHabits(ctx: Ctx, date?: string) {
  const today = date ?? localDate(ctx.now);
  const rows = await ctx.db.select().from(habit).orderBy(asc(habit.order), asc(habit.name));
  const sorted = [...rows.filter((h) => h.active), ...rows.filter((h) => !h.active)];
  return Promise.all(sorted.map((h) => habitProgress(ctx, h, today)));
}

export async function createHabit(ctx: Ctx, body: z.infer<typeof HabitCreate>) {
  const [{ maxOrder }] = await ctx.db.select({ maxOrder: max(habit.order) }).from(habit);
  const [h] = await ctx.db
    .insert(habit)
    .values({ ...body, unit: body.unit ?? null, blockType: body.blockType ?? null, order: body.order ?? (maxOrder ?? -1) + 1, updatedBy: writer(ctx) })
    .returning();
  await recordChange(ctx, { entity: "habit", entityId: h.id, date: null, action: "create", after: habitOut(h) });
  return h;
}

export async function patchHabit(ctx: Ctx, idOrSlug: string, body: z.infer<typeof HabitPatch>) {
  const h = await findHabit(ctx, idOrSlug, true);
  checkVersion(body.version ?? ctx.ifMatch, h, () => habitOut(h));
  const { version: _v, ...set } = body;
  void _v;
  if (set.unit && h.kind !== "numeric") throw validation([{ path: "/unit", message: "Only numeric habits have a unit" }], 422);
  const [row] = await ctx.db.update(habit).set({ ...set, updatedBy: writer(ctx) }).where(eq(habit.id, h.id)).returning();
  await recordChange(ctx, { entity: "habit", entityId: h.id, date: null, action: "update", fields: diffFields(h as unknown as Record<string, unknown>, set) });
  return row;
}

export async function upsertHabitLog(ctx: Ctx, idOrSlug: string, body: z.infer<typeof HabitLogUpsert>) {
  const h = await findHabit(ctx, idOrSlug);
  agentPastGuard(ctx, body.date);
  if (body.value !== undefined && body.value !== null && h.kind !== "numeric") throw validation([{ path: "/value", message: "Only numeric habits take a value" }], 422);
  const by = writer(ctx);
  const source = by === "agent" ? "agent" : "user";
  const [existing] = await ctx.db.select().from(habitLog).where(and(eq(habitLog.habitId, h.id), eq(habitLog.date, body.date))).for("update");
  const values = { done: body.done, value: body.value ?? null };

  if (!existing) {
    const [row] = await ctx.db.insert(habitLog).values({ habitId: h.id, date: body.date, ...values, source, updatedBy: by }).returning();
    await recordChange(ctx, { entity: "habit_log", entityId: row.id, date: body.date, action: "create", fields: diffFields({}, values), webhook: { habit: { slug: h.slug, name: h.name } } });
    return { status: 201, row, slug: h.slug };
  }
  checkVersion(body.version ?? ctx.ifMatch, existing, () => habitLogOut(existing, h.slug));
  const unchanged = existing.done === values.done && (existing.value === null ? null : Number(existing.value)) === values.value;
  if (source === "agent" && existing.source === "user" && !unchanged) throw userEditConflict("This log was set by the user.", habitLogOut(existing, h.slug));
  if (unchanged) return { status: 200, row: existing, slug: h.slug };
  const [row] = await ctx.db.update(habitLog).set({ ...values, source, updatedBy: by }).where(eq(habitLog.id, existing.id)).returning();
  await recordChange(ctx, {
    entity: "habit_log",
    entityId: row.id,
    date: body.date,
    action: "update",
    fields: diffFields({ done: existing.done, value: existing.value === null ? null : Number(existing.value) }, values),
    webhook: { habit: { slug: h.slug, name: h.name } },
  });
  return { status: 200, row, slug: h.slug };
}

// ---------- tasks ----------

async function getTask(ctx: Ctx, id: string) {
  const [t] = await ctx.db.select().from(task).where(eq(task.id, id)).for("update");
  if (!t) throw notFound("Task");
  return t;
}

async function checkRelatedBlock(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const [b] = await ctx.db.select({ id: block.id }).from(block).where(eq(block.id, id));
  if (!b) throw validation([{ path: "/relatedBlockId", message: "Unknown block" }], 422);
}

export async function listTasks(ctx: Ctx, date: string | undefined, done: "true" | "false" | undefined) {
  const conds = [eq(task.date, date ?? localDate(ctx.now))];
  if (done) conds.push(eq(task.done, done === "true"));
  const rows = await ctx.db.select().from(task).where(and(...conds)).orderBy(asc(task.order), asc(task.createdAt));
  return rows.map(taskOut);
}

export async function createTask(ctx: Ctx, body: z.infer<typeof TaskCreate>) {
  agentPastGuard(ctx, body.date);
  await checkRelatedBlock(ctx, body.relatedBlockId);
  const [{ maxOrder }] = await ctx.db.select({ maxOrder: max(task.order) }).from(task).where(eq(task.date, body.date));
  const by = writer(ctx);
  const [t] = await ctx.db
    .insert(task)
    .values({
      ...(body.id ? { id: body.id } : {}),
      date: body.date,
      title: body.title,
      kind: body.kind ?? "other",
      origin: by === "agent" ? "agent" : "user",
      relatedBlockId: body.relatedBlockId ?? null,
      order: body.order ?? (maxOrder ?? -1) + 1,
      updatedBy: by,
    })
    .returning();
  await recordChange(ctx, { entity: "task", entityId: t.id, date: t.date, action: "create", after: taskOut(t), webhook: { task: { title: t.title, kind: t.kind } } });
  return t;
}

export async function patchTask(ctx: Ctx, id: string, body: z.infer<typeof TaskPatch>) {
  const t = await getTask(ctx, id);
  checkVersion(body.version ?? ctx.ifMatch, t, () => taskOut(t));
  const { version: _v, ...patch } = body;
  void _v;
  agentPastGuard(ctx, t.date);
  if (ctx.caller === "agent") {
    if (t.origin === "user") {
      const onlyDone = Object.keys(patch).every((k) => k === "done") && patch.done === true && !t.done;
      if (!onlyDone) throw userEditConflict("This task is mine; the agent can only mark it done.", taskOut(t));
    } else if (patch.done === false && t.done && t.updatedBy === "user") {
      throw userEditConflict("I marked this task done.", taskOut(t));
    }
  }
  await checkRelatedBlock(ctx, patch.relatedBlockId);
  const set: Partial<typeof task.$inferInsert> = { ...patch };
  if (patch.done !== undefined && patch.done !== t.done) set.doneAt = patch.done ? ctx.now : null;
  const [row] = await ctx.db.update(task).set({ ...set, updatedBy: writer(ctx) }).where(eq(task.id, t.id)).returning();
  const fields = diffFields(t as unknown as Record<string, unknown>, patch);
  await recordChange(ctx, { entity: "task", entityId: t.id, date: row.date, action: "update", fields, webhook: { task: { title: row.title, kind: row.kind } } });
  return row;
}

export async function deleteTask(ctx: Ctx, id: string) {
  const t = await getTask(ctx, id);
  checkVersion(ctx.ifMatch, t, () => taskOut(t));
  if (ctx.caller === "agent" && t.origin === "user") throw userEditConflict("This task is mine.", taskOut(t));
  agentPastGuard(ctx, t.date);
  await ctx.db.delete(task).where(eq(task.id, t.id));
  await recordChange(ctx, { entity: "task", entityId: t.id, date: t.date, action: "delete", before: taskOut(t), webhook: { task: { title: t.title, kind: t.kind } } });
}

// ---------- sleep ----------

async function sleepRowOut(ctx: Ctx, row: typeof sleepLog.$inferSelect) {
  return sleepOut(row, await plannedSleep(ctx, row.date));
}

export async function listSleep(ctx: Ctx, from?: string, to?: string) {
  const end = to ?? localDate(ctx.now);
  const start = from ?? addDays(end, -13);
  if (start > end) throw validation([{ path: "query/from", message: "from must be ≤ to" }]);
  const rows = await ctx.db.select().from(sleepLog).where(and(gte(sleepLog.date, start), lte(sleepLog.date, end))).orderBy(asc(sleepLog.date));
  return Promise.all(rows.map((r) => sleepRowOut(ctx, r)));
}

function checkSleepTimes(ctx: Ctx, bedAt: Date | null, wokeAt: Date | null) {
  const future = (d: Date | null) => d && d.getTime() > ctx.now.getTime() + 5 * 60_000;
  if (future(bedAt) || future(wokeAt)) throw validation([{ path: future(bedAt) ? "/bedAt" : "/wokeAt", message: "Cannot be in the future" }], 422);
  if (bedAt && wokeAt && (wokeAt <= bedAt || wokeAt.getTime() - bedAt.getTime() >= 20 * 3_600_000))
    throw validation([{ path: "/wokeAt", message: "Must be after bedAt and within 20 h" }], 422);
}

async function writeSleep(ctx: Ctx, date: string, change: { bedAt?: Date | null; wokeAt?: Date | null; note?: string | null }, expected?: number | null) {
  const by = writer(ctx);
  const source = by === "agent" ? "agent" : "user";
  const [existing] = await ctx.db.select().from(sleepLog).where(eq(sleepLog.date, date)).for("update");
  if (existing) checkVersion(expected, existing, () => existing);

  const next = {
    bedAt: change.bedAt !== undefined ? change.bedAt : (existing?.bedAt ?? null),
    wokeAt: change.wokeAt !== undefined ? change.wokeAt : (existing?.wokeAt ?? null),
    note: change.note !== undefined ? change.note : (existing?.note ?? null),
  };
  if (source === "agent" && existing) {
    const mine = (["bedAt", "wokeAt"] as const).filter((k) => {
      const src = k === "bedAt" ? existing.bedSource : existing.wakeSource;
      return change[k] !== undefined && existing[k] !== null && src === "user" && existing[k]!.getTime() !== change[k]?.getTime();
    });
    if (mine.length) throw userEditConflict(`${mine.join(", ")} set by the user.`, await sleepRowOut(ctx, existing));
  }
  checkSleepTimes(ctx, next.bedAt, next.wokeAt);

  const sources = {
    bedSource: next.bedAt === null ? null : change.bedAt !== undefined ? source : (existing?.bedSource ?? source),
    wakeSource: next.wokeAt === null ? null : change.wokeAt !== undefined ? source : (existing?.wakeSource ?? source),
  };
  const [row] = existing
    ? await ctx.db.update(sleepLog).set({ ...next, ...sources, updatedBy: by }).where(eq(sleepLog.id, existing.id)).returning()
    : await ctx.db.insert(sleepLog).values({ date, ...next, ...sources, updatedBy: by }).returning();

  const iso = (d: Date | null) => isoLocalOrNull(d);
  await recordChange(ctx, {
    entity: "sleep_log",
    entityId: row.id,
    date,
    action: existing ? "update" : "create",
    fields: diffFields({ bedAt: iso(existing?.bedAt ?? null), wokeAt: iso(existing?.wokeAt ?? null), note: existing?.note ?? null }, { bedAt: iso(next.bedAt), wokeAt: iso(next.wokeAt), note: next.note }),
    webhook: { sleep: { night: date, bedAt: iso(next.bedAt), wokeAt: iso(next.wokeAt) } },
  });
  if (change.bedAt && !existing?.bedAt) {
    const d = await findDay(ctx, date);
    if (d) await markSleepBlockDone(ctx, d);
  }
  return { status: existing ? 200 : 201, row };
}

export async function sleepEvent(ctx: Ctx, body: z.infer<typeof SleepEvent>) {
  const at = body.at ? new Date(body.at) : ctx.now;
  const night = sleepNightFor(at);
  agentPastGuard(ctx, addDays(night, 1));
  const r = await writeSleep(ctx, night, body.type === "bed" ? { bedAt: at } : { wokeAt: at });
  return { status: r.status, body: await sleepRowOut(ctx, r.row) };
}

export async function upsertSleep(ctx: Ctx, date: string, body: z.infer<typeof SleepUpsert>) {
  if (ctx.caller === "agent" && body.note !== undefined) throw forbidden("The note is mine.");
  const r = await writeSleep(
    ctx,
    date,
    {
      ...(body.bedAt !== undefined ? { bedAt: body.bedAt === null ? null : new Date(body.bedAt) } : {}),
      ...(body.wokeAt !== undefined ? { wokeAt: body.wokeAt === null ? null : new Date(body.wokeAt) } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    },
    body.version ?? ctx.ifMatch,
  );
  return { status: r.status, body: await sleepRowOut(ctx, r.row) };
}


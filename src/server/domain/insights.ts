import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { block, changeLog, day, habit, habitLog, planOption, proposal, sleepLog, task } from "../db/schema";
import type { Ctx } from "../http/context";
import { validation } from "../http/errors";
import { addDays, dateRange, daysBetween, fromMinutes, isoLocal, localDate, localTime, monthEnd, monthStart, toMinutes, weekStart } from "../time";
import { ensureClosedIfPast } from "./days";
import { primaryOption, sleepFor } from "./load";
import type { BlockRow, DayRow, HabitRow, OptionRow } from "./rows";
import { taskOut } from "./serialize";
import { periodCount, periodMet, periodStart, periodsInRange, streaks } from "./streaks";
import { points } from "./tracking";

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) / 100 : null);

/** Days in [from, to] with the blocks of their primary option (chosen, else A). Past days are lazily closed. */
async function daysWithBlocks(ctx: Ctx, from: string, to: string) {
  const rows = await ctx.db.select().from(day).where(and(gte(day.date, from), lte(day.date, to))).orderBy(asc(day.date));
  const closed: DayRow[] = [];
  for (const d of rows) closed.push(await ensureClosedIfPast(ctx, d));
  if (!closed.length) return [];
  const ids = closed.map((d) => d.id);
  const options = await ctx.db.select().from(planOption).where(inArray(planOption.dayId, ids));
  const blocks = await ctx.db.select().from(block).where(inArray(block.dayId, ids));
  return closed.map((d) => {
    const opt = primaryOption(d, options.filter((o: OptionRow) => o.dayId === d.id));
    return { day: d, option: opt, blocks: blocks.filter((b: BlockRow) => b.optionId === opt?.id) };
  });
}

const MAX_RANGE = 400;

export async function listDays(ctx: Ctx, from: string, to: string) {
  if (from > to) throw validation([{ path: "query/from", message: "from must be ≤ to" }]);
  if (daysBetween(from, to) > MAX_RANGE) throw validation([{ path: "query/to", message: `Max ${MAX_RANGE} days` }]);
  const days = await daysWithBlocks(ctx, from, to);
  const pending = await ctx.db.select({ dayId: proposal.dayId }).from(proposal).where(eq(proposal.status, "pending"));
  const withProposal = new Set(pending.map((p) => p.dayId));
  return days.map(({ day: d, option, blocks }) => ({
    date: d.date,
    status: d.status,
    chosenOption: d.chosenOptionId ? (option?.label ?? null) : null,
    blocksTotal: blocks.length,
    blocksDone: blocks.filter((b) => b.status === "done").length,
    blocksSkipped: blocks.filter((b) => b.status === "skipped").length,
    completion: rate(blocks.filter((b) => b.status === "done").length, blocks.length),
    callsTotal: blocks.filter((b) => b.type === "call").length,
    review: d.reviewEnergy === null || d.reviewMood === null ? null : { energy: d.reviewEnergy, mood: d.reviewMood, text: d.reviewText },
    hasPendingProposal: withProposal.has(d.id),
    version: d.version,
  }));
}

async function linkedHabit(ctx: Ctx, type: "gym" | "reading"): Promise<HabitRow | null> {
  const [h] = await ctx.db.select().from(habit).where(and(eq(habit.blockType, type), eq(habit.active, true))).limit(1);
  if (h) return h;
  const [bySlug] = await ctx.db.select().from(habit).where(eq(habit.slug, type)).limit(1);
  return bySlug ?? null;
}

export function rangeBounds(range: "week" | "month" | "year", anchor: string) {
  if (range === "week") return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  if (range === "month") return { from: monthStart(anchor), to: monthEnd(anchor) };
  return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
}

export async function metrics(ctx: Ctx, range: "week" | "month" | "year", anchor?: string) {
  const today = localDate(ctx.now);
  const { from, to } = rangeBounds(range, anchor ?? today);
  const lastDay = to < today ? to : today;
  const days = await daysWithBlocks(ctx, from, to);
  const all = days.flatMap((d) => d.blocks);

  const byType = [...new Set(all.map((b) => b.type))].sort().map((type) => {
    const list = all.filter((b) => b.type === type);
    const done = list.filter((b) => b.status === "done").length;
    return { type, total: list.length, done, skipped: list.filter((b) => b.status === "skipped").length, doneRate: rate(done, list.length) };
  });

  const calls = all.filter((b) => b.type === "call");
  const outcomes = { closed_won: 0, follow_up: 0, no_show: 0, rescheduled: 0, lost: 0, unset: 0 };
  for (const c of calls) outcomes[c.outcome ?? "unset"]++;
  const withOutcome = calls.length - outcomes.unset;
  const showDen = withOutcome - outcomes.rescheduled;
  const showed = showDen - outcomes.no_show;

  const gym = await linkedHabit(ctx, "gym");
  const gymLogs = gym ? points(await ctx.db.select().from(habitLog).where(and(eq(habitLog.habitId, gym.id), gte(habitLog.date, weekStart(from)), lte(habitLog.date, to)))) : [];
  const weeks: Array<{ weekStart: string; count: number; target: number | null }> = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7))
    weeks.push({ weekStart: w, count: gymLogs.filter((l) => l.done && l.date >= w && l.date <= addDays(w, 6)).length, target: gym?.targetPeriod === "week" ? gym.targetCount : null });

  const reading = await linkedHabit(ctx, "reading");
  const readingLogs = reading ? await ctx.db.select().from(habitLog).where(and(eq(habitLog.habitId, reading.id), gte(habitLog.date, from), lte(habitLog.date, to))) : [];

  const sleepRows = await ctx.db.select().from(sleepLog).where(and(gte(sleepLog.date, from), lte(sleepLog.date, lastDay)));
  const nights = await Promise.all(
    sleepRows.map(async (s) => {
      const out = await sleepFor(ctx, s.date);
      return { s, out: out! };
    }),
  );
  const complete = nights.filter((n) => n.out.durationMinutes !== null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const bedMinutes = nights.filter((n) => n.s.bedAt).map((n) => toMinutes(localTime(n.s.bedAt!)) + (localDate(n.s.bedAt!) > n.s.date ? 24 * 60 : 0));
  const wakeMinutes = nights.filter((n) => n.s.wokeAt).map((n) => toMinutes(localTime(n.s.wokeAt!)));
  const delays = nights.map((n) => n.out.bedDelayMinutes).filter((x): x is number => x !== null);

  const habits = await ctx.db.select().from(habit).where(eq(habit.active, true)).orderBy(asc(habit.order));
  const habitStats = await Promise.all(
    habits.map(async (h) => {
      const pts = points(await ctx.db.select().from(habitLog).where(eq(habitLog.habitId, h.id)));
      const s = streaks(h, pts, today);
      const p = periodsInRange(h, pts, from, lastDay, today);
      return { slug: h.slug, name: h.name, currentStreak: s.current, bestStreak: s.best, periodsMet: p.met, periodsTotal: p.total };
    }),
  );

  const dates = dateRange(from, lastDay);
  const done = all.filter((b) => b.status === "done").length;
  return {
    range,
    from,
    to,
    gym: { habitSlug: gym?.slug ?? null, weeks, total: gymLogs.filter((l) => l.done && l.date >= from && l.date <= to).length },
    reading: { habitSlug: reading?.slug ?? null, days: readingLogs.filter((l) => l.done).length, totalDays: dates.length },
    blocks: {
      total: all.length,
      done,
      skipped: all.filter((b) => b.status === "skipped").length,
      pending: all.filter((b) => b.status === "pending").length,
      doneRate: rate(done, all.length),
      byType,
    },
    calls: {
      total: calls.length,
      perDay: dates.map((date) => ({ date, count: days.find((d) => d.day.date === date)?.blocks.filter((b) => b.type === "call").length ?? 0 })),
      outcomes,
      showUpRate: rate(showed, showDen),
      closeRate: rate(outcomes.closed_won, showed),
    },
    sleep: {
      nightsLogged: complete.length,
      nightsTotal: dates.length,
      avgDurationMinutes: avg(complete.map((n) => n.out.durationMinutes!)),
      avgBedtime: bedMinutes.length ? fromMinutes(avg(bedMinutes)!) : null,
      avgWakeTime: wakeMinutes.length ? fromMinutes(avg(wakeMinutes)!) : null,
      avgBedDelayMinutes: avg(delays),
      nights: dates.map((date) => {
        const n = nights.find((x) => x.s.date === date);
        return { date, durationMinutes: n?.out.durationMinutes ?? null, bedDelayMinutes: n?.out.bedDelayMinutes ?? null };
      }),
    },
    habits: habitStats,
  };
}

export async function agentContext(ctx: Ctx, date?: string) {
  const target = date ?? localDate(ctx.now);
  const ws = weekStart(target);
  const habits = await ctx.db.select().from(habit).where(eq(habit.active, true)).orderBy(asc(habit.order));
  const logsByHabit = new Map<string, ReturnType<typeof points>>();
  for (const h of habits) logsByHabit.set(h.id, points(await ctx.db.select().from(habitLog).where(eq(habitLog.habitId, h.id))));

  const gym = await linkedHabit(ctx, "gym");
  let weeklyGym: { done: number; target: number; source: "habit" | "agent_report" } | null = null;
  if (gym && gym.targetPeriod === "week") {
    weeklyGym = { done: periodCount(gym, logsByHabit.get(gym.id) ?? points(await ctx.db.select().from(habitLog).where(eq(habitLog.habitId, gym.id))), ws), target: gym.targetCount, source: "habit" };
  } else {
    const [reported] = await ctx.db.select().from(day).where(and(lte(day.date, target), gte(day.date, ws), isNotNull(day.weeklyGymTarget))).orderBy(desc(day.date)).limit(1);
    if (reported) weeklyGym = { done: reported.weeklyGymDone!, target: reported.weeklyGymTarget!, source: "agent_report" };
  }

  const remainingDays = (h: HabitRow) => (h.targetPeriod === "day" ? 1 : daysBetween(target, addDays(ws, 6)) + 1);
  const pendingToday = habits
    .filter((h) => !periodMet(h, logsByHabit.get(h.id)!, periodStart(h, target)))
    .map((h) => ({ slug: h.slug, name: h.name, kind: h.kind, periodCount: periodCount(h, logsByHabit.get(h.id)!, periodStart(h, target)), periodTarget: h.targetCount, targetPeriod: h.targetPeriod }));

  type Risk = { slug: string; name: string; currentStreak: number; reason: "not_done_today" | "week_target_unreachable_soon"; remainingInPeriod: number };
  const atRisk = habits.flatMap((h): Risk[] => {
    const pts = logsByHabit.get(h.id)!;
    const s = streaks(h, pts, target);
    if (!s.current || periodMet(h, pts, periodStart(h, target))) return [];
    const remaining = h.targetCount - periodCount(h, pts, periodStart(h, target));
    if (h.targetPeriod === "day") return [{ slug: h.slug, name: h.name, currentStreak: s.current, reason: "not_done_today" as const, remainingInPeriod: remaining }];
    const doable = h.kind === "boolean" ? remainingDays(h) : Number.POSITIVE_INFINITY;
    return remaining >= doable ? [{ slug: h.slug, name: h.name, currentStreak: s.current, reason: "week_target_unreachable_soon" as const, remainingInPeriod: remaining }] : [];
  });

  const yDate = addDays(target, -1);
  const [yd] = await daysWithBlocks(ctx, yDate, yDate);
  const yTasks = await ctx.db.select().from(task).where(and(eq(task.date, yDate), eq(task.done, false))).orderBy(asc(task.order));
  const yesterday = yd
    ? {
        date: yDate,
        status: yd.day.status,
        completion: rate(yd.blocks.filter((b) => b.status === "done").length, yd.blocks.length),
        blocksDone: yd.blocks.filter((b) => b.status === "done").length,
        blocksTotal: yd.blocks.length,
        unfinishedTasks: yTasks.map(taskOut),
      }
    : null;

  const [lastReviewDay] = await ctx.db.select().from(day).where(and(lt(day.date, target), isNotNull(day.reviewEnergy))).orderBy(desc(day.date)).limit(1);

  const window = await daysWithBlocks(ctx, addDays(target, -14), yDate);
  const groups = new Map<string, { type: BlockRow["type"]; hour: string; skipped: number; total: number }>();
  for (const b of window.flatMap((w) => w.blocks).filter((b) => b.source === "agent")) {
    const hour = `${b.start.slice(0, 2)}:00`;
    const k = `${b.type}@${hour}`;
    const g = groups.get(k) ?? { type: b.type, hour, skipped: 0, total: 0 };
    g.total++;
    if (b.status === "skipped") g.skipped++;
    groups.set(k, g);
  }
  const skippedPatterns = [...groups.values()].filter((g) => g.skipped >= 3 && g.skipped / g.total >= 0.5 && Number(g.hour.slice(0, 2)) < 24);

  const [pd] = await ctx.db.select().from(day).where(eq(day.date, target));
  const [pp] = pd ? await ctx.db.select().from(proposal).where(and(eq(proposal.dayId, pd.id), eq(proposal.status, "pending"))) : [];

  return {
    date: target,
    weekStart: ws,
    weeklyGym,
    habitsPendingToday: pendingToday,
    streaksAtRisk: atRisk,
    yesterday,
    lastReview: lastReviewDay ? { date: lastReviewDay.date, energy: lastReviewDay.reviewEnergy!, mood: lastReviewDay.reviewMood!, text: lastReviewDay.reviewText } : null,
    lastNightSleep: await sleepFor(ctx, yDate),
    skippedPatterns,
    pendingProposal: pp ? { id: pp.id, createdAt: isoLocal(pp.createdAt) } : null,
  };
}

export async function listChangelog(
  ctx: Ctx,
  q: { from?: string; to?: string; actor?: "agent" | "user" | "system"; cursor?: string; limit?: number },
) {
  const limit = q.limit ?? 100;
  const conds = [];
  if (q.from) conds.push(gte(changeLog.date, q.from));
  if (q.to) conds.push(lte(changeLog.date, q.to));
  if (q.actor) conds.push(eq(changeLog.actor, q.actor));
  if (q.cursor) conds.push(lt(changeLog.id, q.cursor));
  const rows = await ctx.db
    .select()
    .from(changeLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(changeLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id,
      actor: r.actor,
      entity: r.entity,
      entityId: r.entityId,
      date: r.date,
      action: r.action,
      diff: r.diff,
      forced: r.forced,
      requestId: r.requestId,
      at: isoLocal(r.at),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export async function exportAll(ctx: Ctx) {
  const [days, options, blocks, habits, habitLogs, tasks, proposals, sleep, changes] = await Promise.all([
    ctx.db.select().from(day).orderBy(asc(day.date)),
    ctx.db.select().from(planOption),
    ctx.db.select().from(block),
    ctx.db.select().from(habit),
    ctx.db.select().from(habitLog).orderBy(asc(habitLog.date)),
    ctx.db.select().from(task).orderBy(asc(task.date)),
    ctx.db.select().from(proposal),
    ctx.db.select().from(sleepLog).orderBy(asc(sleepLog.date)),
    ctx.db.select().from(changeLog).orderBy(asc(changeLog.at)),
  ]);
  return {
    exportedAt: isoLocal(ctx.now),
    schemaVersion: 1 as const,
    days: days.map((d) => ({ ...d, options: options.filter((o) => o.dayId === d.id).map((o) => ({ ...o, blocks: blocks.filter((b) => b.optionId === o.id) })) })),
    habits,
    habitLogs,
    tasks,
    proposals,
    sleepLogs: sleep,
    changeLog: changes,
  };
}


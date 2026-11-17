import { and, asc, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { dayReview, event, habit, habitLog, reminder, sleepLog, task } from "../db/schema";
import type { Ctx } from "../http/context";
import { validation } from "../http/errors";
import { listHabits, userToday } from "./habits";
import { getReview } from "./review";
import { sleepOn } from "./sleep";
import { type HabitDef, periodMet, periodsInRange } from "./streaks";
import { listTasks, taskOut } from "./tasks";
import { addDays, dateOf, dateRange, fromDate, type IsoDate, monthEnd, monthStart, timeOf, toDate, toInstant, weekStart } from "./time";

/** ISO dates compare as strings. */
const earlier = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** [from 00:00, to + 1 00:00) in the user's zone, as Dates for the database. */
const dayBounds = (from: IsoDate, to: IsoDate, tz: string) => ({
  start: toDate(toInstant(from, null, tz)),
  end: toDate(toInstant(addDays(to, 1), null, tz)),
});

/**
 * Local dates are computed here with Temporal, never with `AT TIME ZONE` in SQL: the database's tz data may lack
 * backward-compatible names (Postgres 18 in the pgvector image rejects "America/Buenos_Aires").
 */
const localDay = (d: Date | null, tz: string) => (d ? dateOf(fromDate(d), tz) : "");

// ---------- day summary ----------

/** getDaySummary: what happened (or is pending) on a day. Sunday's evening review reads this. */
export async function daySummary(ctx: Ctx, q: { date?: IsoDate }) {
  const date = q.date ?? userToday(ctx);
  const { start, end } = dayBounds(date, date, ctx.tz);
  const done = await ctx.db
    .select()
    .from(task)
    .where(and(isNull(task.deletedAt), eq(task.status, "done"), gte(task.completedAt, start), lt(task.completedAt, end)))
    .orderBy(asc(task.completedAt));
  const byDue = <T extends { dueTime: string | null }>(a: T, b: T) => (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99");
  return {
    date,
    tasks: {
      done: done.map((t) => taskOut(t, ctx)),
      pending: (await listTasks(ctx, { status: "open", dueFrom: date, dueTo: date, limit: 500 })).sort(byDue),
      overdue: await listTasks(ctx, { status: "open", dueTo: addDays(date, -1), limit: 200 }),
    },
    habits: await listHabits(ctx, { date }),
    sleep: await sleepOn(ctx, date),
    review: await getReview(ctx, date),
  };
}

// ---------- history ----------

/** Historial: one entry per day of the month (up to today): tasks done, daily habits met, sleep, mood. */
export async function history(ctx: Ctx, q: { month?: string }) {
  const todayDate = userToday(ctx);
  const month = q.month ?? todayDate.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw validation([{ path: "query/month", message: "Expected YYYY-MM" }]);
  const from = `${month}-01`;
  const last = monthEnd(from);
  const to = earlier(last, todayDate);
  if (to < from) return { month, days: [] };
  const { start, end } = dayBounds(from, to, ctx.tz);

  const doneRows = await ctx.db
    .select({ at: task.completedAt })
    .from(task)
    .where(and(isNull(task.deletedAt), eq(task.status, "done"), gte(task.completedAt, start), lt(task.completedAt, end)));
  const done = new Map<string, number>();
  for (const r of doneRows) done.set(localDay(r.at, ctx.tz), (done.get(localDay(r.at, ctx.tz)) ?? 0) + 1);

  const habits = await ctx.db
    .select()
    .from(habit)
    .where(and(isNull(habit.deletedAt), eq(habit.active, true), eq(habit.targetPeriod, "day")));
  const logs = await ctx.db
    .select()
    .from(habitLog)
    .where(and(isNull(habitLog.deletedAt), gte(habitLog.date, from), lte(habitLog.date, to)));
  const sleep = await ctx.db
    .select()
    .from(sleepLog)
    .where(and(isNull(sleepLog.deletedAt), gte(sleepLog.date, from), lte(sleepLog.date, to)));
  const reviews = await ctx.db
    .select()
    .from(dayReview)
    .where(and(gte(dayReview.date, from), lte(dayReview.date, to)));

  const days = dateRange(from, to).map((date) => {
    // a habit counts from the day it was created
    const live = habits.filter((h) => dateOf(fromDate(h.createdAt), ctx.tz) <= date);
    const met = live.filter((h) =>
      periodMet(
        h as HabitDef,
        logs.filter((l) => l.habitId === h.id && l.date === date),
        date,
      ),
    ).length;
    const s = sleep.find((r) => r.date === date);
    const r = reviews.find((x) => x.date === date);
    return {
      date,
      tasksDone: done.get(date) ?? 0,
      habitsMet: met,
      habitsTotal: live.length,
      sleepMinutes: s?.bedAt && s.wakeAt ? Math.round((s.wakeAt.getTime() - s.bedAt.getTime()) / 60_000) : null,
      mood: r?.mood ?? null,
      reviewed: Boolean(r),
    };
  });
  return { month, days };
}

// ---------- metrics ----------

const DOW = ["L", "M", "M", "J", "V", "S", "D"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const hhmm = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const round = (x: number | null, digits = 2) => (x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

export function periodOf(range: "week" | "month" | "year", date: IsoDate) {
  if (range === "week") return { from: weekStart(date), to: addDays(weekStart(date), 6) };
  if (range === "month") return { from: monthStart(date), to: monthEnd(date) };
  return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
}

/** Métricas for a week, month or year: tasks, on-time rate, habit consistency, sleep, mood, Sunday vs by hand. */
export async function metrics(ctx: Ctx, q: { range?: "week" | "month" | "year"; date?: IsoDate }) {
  const range = q.range ?? "week";
  const todayDate = userToday(ctx);
  const { from, to } = periodOf(range, q.date ?? todayDate);
  const { start, end } = dayBounds(from, to, ctx.tz);

  // ---- tasks ----
  const doneRows = (
    await ctx.db
      .select({ at: task.completedAt, dueDate: task.dueDate })
      .from(task)
      .where(and(isNull(task.deletedAt), eq(task.status, "done"), gte(task.completedAt, start), lt(task.completedAt, end)))
  ).map((r) => ({ day: localDay(r.at, ctx.tz), dueDate: r.dueDate }));
  const [created] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(task)
    .where(and(isNull(task.deletedAt), gte(task.createdAt, start), lt(task.createdAt, end)));
  const withDue = doneRows.filter((r) => r.dueDate);
  const onTime = withDue.filter((r) => r.day <= (r.dueDate as string)).length;
  const buckets =
    range === "year"
      ? MONTHS.map((label, i) => {
          const s = `${from.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`;
          return { start: s, label, done: doneRows.filter((r) => r.day.slice(0, 7) === s.slice(0, 7)).length };
        })
      : dateRange(from, to).map((d, i) => ({
          start: d,
          label: range === "week" ? (DOW[i] ?? "") : String(Number(d.slice(8))),
          done: doneRows.filter((r) => r.day === d).length,
        }));

  // ---- habits ----
  const habits = await ctx.db
    .select()
    .from(habit)
    .where(and(isNull(habit.deletedAt), eq(habit.active, true)))
    .orderBy(asc(habit.sortOrder));
  const logs = await ctx.db
    .select()
    .from(habitLog)
    .where(and(isNull(habitLog.deletedAt), gte(habitLog.date, addDays(from, -7)), lte(habitLog.date, to)));
  const habitStats = habits.map((h) => {
    const since = dateOf(fromDate(h.createdAt), ctx.tz);
    const s = periodsInRange(
      h as HabitDef,
      logs.filter((l) => l.habitId === h.id),
      later(since, from),
      earlier(to, todayDate),
      todayDate,
    );
    return {
      id: h.id,
      name: h.name,
      targetPeriod: h.targetPeriod,
      met: s.met,
      total: s.total,
      rate: s.total ? round(s.met / s.total) : null,
    };
  });

  // ---- sleep ----
  const nights = (
    await ctx.db
      .select()
      .from(sleepLog)
      .where(and(isNull(sleepLog.deletedAt), gte(sleepLog.date, from), lte(sleepLog.date, to)))
  ).filter((r) => r.bedAt && r.wakeAt);
  const durations = nights.map((r) => ((r.wakeAt as Date).getTime() - (r.bedAt as Date).getTime()) / 60_000);
  // bedtimes straddle midnight: average them as minutes after noon
  const beds = nights.map((r) => (minutesOf(timeOf(fromDate(r.bedAt as Date), ctx.tz)) + 720) % 1440);
  const wakes = nights.map((r) => minutesOf(timeOf(fromDate(r.wakeAt as Date), ctx.tz)));
  const qualities = (
    await ctx.db
      .select({ q: sleepLog.quality })
      .from(sleepLog)
      .where(and(isNull(sleepLog.deletedAt), gte(sleepLog.date, from), lte(sleepLog.date, to)))
  )
    .map((r) => r.q)
    .filter((x): x is number => x !== null);
  const avgBed = avg(beds);
  const avgWake = avg(wakes);
  const avgDuration = avg(durations);

  // ---- mood ----
  const moods = (
    await ctx.db
      .select({ mood: dayReview.mood })
      .from(dayReview)
      .where(and(gte(dayReview.date, from), lte(dayReview.date, to)))
  )
    .map((r) => r.mood)
    .filter((x): x is number => x !== null);

  // ---- who created things ----
  const counts = { user: 0, sunday: 0 };
  for (const t of [task, reminder, event] as const) {
    const rows = await ctx.db
      .select({ source: t.source, n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(gte(t.createdAt, start), lt(t.createdAt, end), ne(t.source, "system")))
      .groupBy(t.source);
    for (const r of rows) if (r.source === "user" || r.source === "sunday") counts[r.source] += r.n;
  }

  return {
    range,
    from,
    to,
    tasks: {
      done: doneRows.length,
      created: created?.n ?? 0,
      onTime,
      withDue: withDue.length,
      onTimeRate: withDue.length ? round(onTime / withDue.length) : null,
      buckets,
    },
    habits: habitStats,
    sleep: {
      nights: nights.length,
      avgMinutes: avgDuration === null ? null : Math.round(avgDuration),
      avgBedTime: avgBed === null ? null : hhmm(avgBed - 720),
      avgWakeTime: avgWake === null ? null : hhmm(avgWake),
      avgQuality: round(avg(qualities), 1),
    },
    mood: { days: moods.length, avg: round(avg(moods), 1) },
    sources: counts,
  };
}

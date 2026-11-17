import { LocalDate, orNull } from "../common";
import { errorBody } from "../errors";
import * as ex from "../examples";
import type { RouteDef } from "../route-def";
import {
  DayReview,
  DayReviewInput,
  DaySummary,
  HabitCreate,
  HabitLog,
  HabitLogInput,
  HabitPatch,
  HabitProgress,
  HabitQuery,
  History,
  Metrics,
  MetricsQuery,
  RangeQuery,
  SleepEvent,
  SleepLog,
  SleepUpsert,
} from "../tracking";
import { z } from "../zod";

const at = "2026-11-18T21:40:00.000-03:00";
const meta = { version: 1, createdAt: at, updatedAt: at, updatedBy: "user" as const };

const gym = {
  id: ex.uid(90),
  slug: "gym",
  name: "Gym",
  kind: "boolean" as const,
  unit: null,
  targetCount: 3,
  targetPeriod: "week" as const,
  taskTag: "gym",
  active: true,
  sortOrder: 1,
  ...meta,
};
const gymLog = {
  id: ex.uid(91),
  habitId: gym.id,
  date: "2026-11-18",
  done: true,
  value: null,
  source: "user" as const,
  ...meta,
};
const gymProgress = {
  ...gym,
  streak: { current: 2, best: 5, unit: "week" as const },
  period: { start: "2026-11-16", end: "2026-11-22", count: 2, target: 3, met: false },
  log: gymLog,
};
const lectura = {
  ...gym,
  id: ex.uid(92),
  slug: "lectura",
  name: "Lectura",
  kind: "numeric" as const,
  unit: "páginas",
  targetCount: 20,
  targetPeriod: "day" as const,
  taskTag: null,
  sortOrder: 2,
  streak: { current: 0, best: 12, unit: "day" as const },
  period: { start: "2026-11-18", end: "2026-11-18", count: 0, target: 20, met: false },
  log: null,
};

const night = {
  id: ex.uid(93),
  date: "2026-11-18",
  bedAt: "2026-11-17T23:40:00.000-03:00",
  wakeAt: "2026-11-18T07:10:00.000-03:00",
  durationMinutes: 450,
  quality: 4,
  notes: null,
  source: "user" as const,
  ...meta,
};

const review = {
  date: "2026-11-18",
  mood: 4,
  note: "Buen día, salió la propuesta.",
  highlights: ["Gym", "Propuesta enviada"],
  movedTaskIds: [ex.uid(10)],
  ...meta,
};

const habitParam = z.strictObject({
  habit: z.string().min(1).max(60).openapi({ description: "Habit id or slug (`gym`)." }),
});
const dateParam = z.strictObject({ date: LocalDate });

export const habitRoutes: RouteDef[] = [
  {
    operationId: "listHabits",
    method: "get",
    path: "/api/habits",
    tag: "Habits",
    summary: "Habits with today's status and streaks",
    description:
      "Active habits (archived ones with `includeArchived=true`), each with its streak, the period's progress and the day's log.",
    access: "user",
    token: "read",
    query: HabitQuery,
    responses: { 200: { description: "Habits.", schema: z.strictObject({ habits: z.array(HabitProgress) }) } },
    exchanges: [
      {
        name: "today",
        summary: "Gym 2/3 this week, reading pending",
        actor: "user",
        status: 200,
        response: { habits: [gymProgress, lectura] },
      },
    ],
  },
  {
    operationId: "createHabit",
    method: "post",
    path: "/api/habits",
    tag: "Habits",
    summary: "Create a habit",
    description: "Yes/no or numeric, per day or per week. `taskTag`: completing a task with that tag checks the habit.",
    access: "user",
    body: HabitCreate,
    responses: { 201: { description: "Created.", schema: HabitProgress }, 409: { description: "`CONFLICT`: slug or tag in use." } },
    exchanges: [
      {
        name: "gym",
        summary: "Gym 3 times a week, checked by +gym tasks",
        actor: "user",
        body: { name: "Gym", targetCount: 3, targetPeriod: "week", taskTag: "gym" },
        status: 201,
        response: { ...gymProgress, streak: { current: 0, best: 0, unit: "week" }, period: { ...gymProgress.period, count: 0 }, log: null },
      },
    ],
  },
  {
    operationId: "updateHabit",
    method: "patch",
    path: "/api/habits/{habit}",
    tag: "Habits",
    summary: "Change, archive or reorder a habit",
    access: "user",
    ifMatch: true,
    params: habitParam,
    body: HabitPatch,
    responses: {
      200: { description: "Updated.", schema: HabitProgress },
      404: { description: "`NOT_FOUND`." },
      409: { description: "`VERSION_CONFLICT` or `CONFLICT`." },
    },
    exchanges: [
      {
        name: "target",
        summary: "Gym 3 → 4",
        actor: "user",
        params: { habit: "gym" },
        body: { targetCount: 4 },
        status: 200,
        response: { ...gymProgress, targetCount: 4, version: 2, period: { ...gymProgress.period, target: 4 } },
      },
    ],
  },
  {
    operationId: "deleteHabit",
    method: "delete",
    path: "/api/habits/{habit}",
    tag: "Habits",
    summary: "Delete a habit and its history",
    description: "To keep the history, archive it instead (`active: false`).",
    access: "user",
    params: habitParam,
    responses: { 204: { description: "Deleted." }, 404: { description: "`NOT_FOUND`." } },
    exchanges: [{ name: "delete", summary: "Delete", actor: "user", params: { habit: "gym" }, status: 204 }],
  },
  {
    operationId: "logHabit",
    method: "post",
    path: "/api/habits/{habit}/log",
    tag: "Habits",
    summary: "Check (or uncheck) a habit for a date",
    description: "Yes/no: `done` (default true). Numeric: `value` (0 clears). Date defaults to today; never in the future.",
    access: "user",
    token: "write",
    params: habitParam,
    body: HabitLogInput,
    responses: { 200: { description: "The habit as of that date.", schema: HabitProgress }, 404: { description: "`NOT_FOUND`." } },
    exchanges: [
      { name: "check", summary: "Fui al gym", actor: "user", params: { habit: "gym" }, body: {}, status: 200, response: gymProgress },
      {
        name: "pages",
        summary: "25 pages",
        actor: "user",
        params: { habit: "lectura" },
        body: { value: 25 },
        status: 200,
        response: {
          ...lectura,
          streak: { current: 1, best: 12, unit: "day" },
          period: { ...lectura.period, count: 25, met: true },
          log: { ...gymLog, id: ex.uid(94), habitId: lectura.id, value: 25 },
        },
      },
      {
        name: "future",
        summary: "Tomorrow",
        actor: "user",
        params: { habit: "gym" },
        body: { date: "2026-11-19" },
        status: 400,
        response: errorBody("VALIDATION_ERROR", "No se puede marcar un día que todavía no llegó.", {
          fields: [{ path: "/date", message: "Must not be in the future" }],
        }),
      },
    ],
  },
  {
    operationId: "listHabitLogs",
    method: "get",
    path: "/api/habits/{habit}/logs",
    tag: "Habits",
    summary: "A habit's check-ins in a date range",
    access: "user",
    token: "read",
    params: habitParam,
    query: RangeQuery,
    responses: { 200: { description: "Logs.", schema: z.strictObject({ logs: z.array(HabitLog) }) }, 404: { description: "`NOT_FOUND`." } },
    exchanges: [
      {
        name: "week",
        summary: "This week",
        actor: "user",
        params: { habit: "gym" },
        query: { from: "2026-11-16", to: "2026-11-22" },
        status: 200,
        response: { logs: [gymLog] },
      },
    ],
  },
];

export const sleepRoutes: RouteDef[] = [
  {
    operationId: "listSleep",
    method: "get",
    path: "/api/sleep",
    tag: "Sleep",
    summary: "Nights in a date range (by wake-up date)",
    access: "user",
    token: "read",
    query: RangeQuery,
    responses: { 200: { description: "Nights.", schema: z.strictObject({ logs: z.array(SleepLog) }) } },
    exchanges: [
      {
        name: "week",
        summary: "This week",
        actor: "user",
        query: { from: "2026-11-16", to: "2026-11-22" },
        status: 200,
        response: { logs: [night] },
      },
    ],
  },
  {
    operationId: "logSleepEvent",
    method: "post",
    path: "/api/sleep/events",
    tag: "Sleep",
    summary: '"Me voy a dormir" / "Me levanté"',
    access: "user",
    token: "write",
    body: SleepEvent,
    responses: {
      200: { description: "The night, updated.", schema: SleepLog },
      201: { description: "The night, started.", schema: SleepLog },
    },
    exchanges: [
      {
        name: "bed",
        summary: "23:40 — Me voy a dormir",
        actor: "user",
        body: { type: "bed" },
        status: 201,
        response: { ...night, wakeAt: null, durationMinutes: null, quality: null },
      },
      {
        name: "wake",
        summary: "07:10 — Me levanté",
        actor: "user",
        body: { type: "wake" },
        status: 200,
        response: { ...night, quality: null },
      },
    ],
  },
  {
    operationId: "upsertSleep",
    method: "put",
    path: "/api/sleep/{date}",
    tag: "Sleep",
    summary: "Load or correct a night by hand",
    access: "user",
    token: "write",
    ifMatch: true,
    params: dateParam,
    body: SleepUpsert,
    responses: {
      200: { description: "Updated.", schema: SleepLog },
      201: { description: "Created.", schema: SleepLog },
      409: { description: "`VERSION_CONFLICT`." },
    },
    exchanges: [
      {
        name: "quality",
        summary: "Slept well",
        actor: "user",
        params: { date: "2026-11-18" },
        body: { quality: 4 },
        status: 200,
        response: night,
      },
    ],
  },
  {
    operationId: "deleteSleep",
    method: "delete",
    path: "/api/sleep/{date}",
    tag: "Sleep",
    summary: "Delete a night",
    access: "user",
    params: dateParam,
    responses: { 204: { description: "Deleted." }, 404: { description: "`NOT_FOUND`." } },
    exchanges: [{ name: "delete", summary: "Delete", actor: "user", params: { date: "2026-11-18" }, status: 204 }],
  },
];

export const reviewRoutes: RouteDef[] = [
  {
    operationId: "getDayReview",
    method: "get",
    path: "/api/reviews/{date}",
    tag: "Review",
    summary: "The day's review (Cierre del día)",
    access: "user",
    token: "read",
    params: dateParam,
    responses: {
      200: { description: "`review: null` when the day wasn't closed.", schema: z.strictObject({ review: orNull(DayReview) }) },
    },
    exchanges: [{ name: "get", summary: "Closed", actor: "user", params: { date: "2026-11-18" }, status: 200, response: { review } }],
  },
  {
    operationId: "saveDayReview",
    method: "put",
    path: "/api/reviews/{date}",
    tag: "Review",
    summary: "Close the day: mood, note, highlights, pending tasks sorted out",
    description: "`moves`: each pending task to tomorrow, the Inbox or dropped (cancelled). Saving again edits the review.",
    access: "user",
    token: "write",
    params: dateParam,
    body: DayReviewInput,
    responses: {
      200: { description: "Updated.", schema: DayReview },
      201: { description: "Created.", schema: DayReview },
      409: { description: "`VERSION_CONFLICT`." },
    },
    exchanges: [
      {
        name: "close",
        summary: "Mood 4, one task to tomorrow",
        actor: "user",
        params: { date: "2026-11-18" },
        body: {
          mood: 4,
          note: "Buen día, salió la propuesta.",
          highlights: ["Gym", "Propuesta enviada"],
          moves: [{ taskId: ex.uid(10), to: "tomorrow" }],
        },
        status: 201,
        response: review,
      },
    ],
  },
  {
    operationId: "getDaySummary",
    method: "get",
    path: "/api/summary/day",
    tag: "Review",
    summary: "Done and pending tasks, habits, sleep and review for a day",
    description: "For the evening review automation. Default today.",
    access: "user",
    token: "read",
    query: z.strictObject({ date: LocalDate.optional() }),
    responses: { 200: { description: "The day.", schema: DaySummary } },
    exchanges: [
      {
        name: "today",
        summary: "Wednesday",
        actor: "user",
        query: { date: "2026-11-18" },
        status: 200,
        response: { date: "2026-11-18", tasks: { done: [], pending: [], overdue: [] }, habits: [gymProgress], sleep: night, review },
      },
    ],
  },
  {
    operationId: "getHistory",
    method: "get",
    path: "/api/history",
    tag: "Review",
    summary: "Historial: each day of a month",
    access: "user",
    token: "read",
    query: z.strictObject({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional()
        .openapi({ description: "`YYYY-MM`, default this month." }),
    }),
    responses: { 200: { description: "Days up to today.", schema: History } },
    exchanges: [
      {
        name: "month",
        summary: "November",
        actor: "user",
        query: { month: "2026-11" },
        status: 200,
        response: {
          month: "2026-11",
          days: [{ date: "2026-11-01", tasksDone: 3, habitsMet: 1, habitsTotal: 1, sleepMinutes: 450, mood: 4, reviewed: true }],
        },
      },
    ],
  },
  {
    operationId: "getMetrics",
    method: "get",
    path: "/api/metrics",
    tag: "Review",
    summary: "Métricas for a week, month or year",
    access: "user",
    token: "read",
    query: MetricsQuery,
    responses: { 200: { description: "Metrics.", schema: Metrics } },
    exchanges: [
      {
        name: "week",
        summary: "This week",
        actor: "user",
        query: { range: "week", date: "2026-11-18" },
        status: 200,
        response: {
          range: "week",
          from: "2026-11-16",
          to: "2026-11-22",
          tasks: {
            done: 9,
            created: 11,
            onTime: 6,
            withDue: 8,
            onTimeRate: 0.75,
            buckets: ["L", "M", "M", "J", "V", "S", "D"].map((label, i) => ({
              start: `2026-11-${16 + i}`,
              label,
              done: [3, 4, 2, 0, 0, 0, 0][i] ?? 0,
            })),
          },
          habits: [{ id: gym.id, name: "Gym", targetPeriod: "week", met: 0, total: 0, rate: null }],
          sleep: { nights: 3, avgMinutes: 445, avgBedTime: "23:50", avgWakeTime: "07:15", avgQuality: 3.7 },
          mood: { days: 2, avg: 4 },
          sources: { user: 14, sunday: 5 },
        },
      },
    ],
  },
];

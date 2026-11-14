import { ExpectedVersion, ItemSource, LocalDate, Mutable, orNull, Timestamp, Uuid } from "./common";
import { Task } from "./tasks";
import { z } from "./zod";

// ---------- habits ----------

export const HabitKind = z.enum(["boolean", "numeric"]).openapi("HabitKind", {
  description: "`boolean`: done or not. `numeric`: a value counts towards the target (pages, km).",
});
export const HabitPeriod = z.enum(["day", "week"]).openapi("HabitPeriod", { description: "Weeks are Monday–Sunday." });

const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes")
  .max(40)
  .openapi({ description: "Stable key, usable instead of the id in paths (`/api/habits/gym/log`).", example: "gym" });

const TaskTag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[^\s#+]+$/, "A tag without spaces, # or +")
  .openapi({ description: "Completing a task tagged with this (`+gym`) checks the habit that day. Yes/no habits only.", example: "gym" });

export const Habit = z
  .strictObject({
    id: Uuid,
    slug: Slug,
    name: z.string(),
    kind: HabitKind,
    unit: z.string().nullable(),
    targetCount: z.int(),
    targetPeriod: HabitPeriod,
    taskTag: z.string().nullable(),
    active: z.boolean().openapi({ description: "Archived habits keep their history but leave Hoy." }),
    sortOrder: z.int(),
    ...Mutable,
  })
  .openapi("Habit");

export const HabitLog = z
  .strictObject({
    id: Uuid,
    habitId: Uuid,
    date: LocalDate,
    done: z.boolean(),
    value: z.number().nullable(),
    source: ItemSource.openapi({ description: "`system` when a tagged task checked it." }),
    ...Mutable,
  })
  .openapi("HabitLog");

export const HabitProgress = z
  .strictObject({
    ...Habit.shape,
    streak: z.strictObject({ current: z.int(), best: z.int(), unit: HabitPeriod }).openapi({
      description: "Consecutive days (daily) or weeks (weekly) meeting the target. The running period doesn't break it until it ends.",
    }),
    period: z.strictObject({
      start: LocalDate,
      end: LocalDate,
      count: z.number().openapi({ description: "Days done (yes/no) or sum of values (numeric) in the period." }),
      target: z.int(),
      met: z.boolean(),
    }),
    log: orNull(HabitLog).openapi({ description: "The log of the requested date (default today)." }),
  })
  .openapi("HabitProgress");

export const HabitCreate = z
  .strictObject({
    slug: Slug.optional().openapi({ description: "Default: from the name." }),
    name: z.string().trim().min(1).max(100),
    kind: HabitKind.optional().openapi({ description: "Default `boolean`." }),
    unit: z.string().trim().max(20).nullable().optional(),
    targetCount: z.int().min(1).max(10_000).optional().openapi({ description: "Default 1." }),
    targetPeriod: HabitPeriod.optional().openapi({ description: "Default `day`." }),
    taskTag: TaskTag.nullable().optional(),
  })
  .refine((h) => !h.unit || h.kind === "numeric", { path: ["unit"], message: "Only numeric habits have a unit" })
  .refine((h) => !h.taskTag || (h.kind ?? "boolean") === "boolean", { path: ["taskTag"], message: "Only yes/no habits follow a task tag" })
  .openapi("HabitCreate");

export const HabitPatch = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    targetCount: z.int().min(1).max(10_000).optional(),
    targetPeriod: HabitPeriod.optional(),
    taskTag: TaskTag.nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.int().min(0).optional(),
    version: ExpectedVersion,
  })
  .openapi("HabitPatch", { description: "`slug` and `kind` don't change." });

export const HabitLogInput = z
  .strictObject({
    date: LocalDate.optional().openapi({ description: "Default today (user's timezone)." }),
    done: z.boolean().optional().openapi({ description: "Yes/no habits: check (true) or uncheck (false). Default true." }),
    value: z
      .number()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional()
      .openapi({ description: "Numeric habits: the day's value (0 or null clears it)." }),
  })
  .openapi("HabitLogInput");

export const HabitQuery = z
  .strictObject({
    date: LocalDate.optional().openapi({ description: "The day to report (default today)." }),
    includeArchived: z.enum(["true", "false"]).optional(),
  })
  .openapi("HabitQuery");

export const RangeQuery = z.strictObject({ from: LocalDate, to: LocalDate }).openapi("RangeQuery");

// ---------- sleep ----------

export const SleepLog = z
  .strictObject({
    id: Uuid,
    date: LocalDate.openapi({ description: "The **wake-up** date: bed Wed 23:30 → up Thu 07:10 is Thursday." }),
    bedAt: orNull(Timestamp),
    wakeAt: orNull(Timestamp),
    durationMinutes: z.int().nullable(),
    quality: z.int().min(1).max(5).nullable(),
    notes: z.string().nullable(),
    source: ItemSource,
    ...Mutable,
  })
  .openapi("SleepLog");

export const SleepEvent = z
  .strictObject({
    type: z.enum(["bed", "wake"]).openapi({ description: '`bed` = "Me voy a dormir", `wake` = "Me levanté".' }),
    at: Timestamp.optional().openapi({ description: 'Default now. Back-date: "me dormí a las 00:20".' }),
  })
  .openapi("SleepEvent", {
    description: "The night is resolved from the time: going to bed from noon on counts for the next day's row; waking up, for that day's.",
  });

export const SleepUpsert = z
  .strictObject({
    bedAt: orNull(Timestamp).optional(),
    wakeAt: orNull(Timestamp).optional(),
    quality: z.int().min(1).max(5).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    version: ExpectedVersion,
  })
  .openapi("SleepUpsert", { description: "Load or correct a night by hand. Not in the future; wake after bed; under 20 h." });

// ---------- day review ----------

export const DayReview = z
  .strictObject({
    date: LocalDate,
    mood: z.int().min(1).max(5).nullable(),
    note: z.string().nullable(),
    highlights: z.array(z.string()),
    movedTaskIds: z.array(Uuid),
    version: z.int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    updatedBy: ItemSource,
  })
  .openapi("DayReview");

export const ReviewMove = z
  .strictObject({
    taskId: Uuid,
    to: z.enum(["tomorrow", "inbox", "drop"]).openapi({
      description:
        "`tomorrow`: due the next day (keeps the time). `inbox`: no date, to the Inbox. `drop`: cancelled (a recurring one moves on to its next occurrence).",
    }),
  })
  .openapi("ReviewMove");

export const DayReviewInput = z
  .strictObject({
    mood: z.int().min(1).max(5).nullable().optional(),
    note: z.string().max(5000).nullable().optional(),
    highlights: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
    moves: z
      .array(ReviewMove)
      .max(200)
      .optional()
      .openapi({ description: "Pending tasks to sort out; applied once, recorded in movedTaskIds." }),
    version: ExpectedVersion,
  })
  .openapi("DayReviewInput");

export const DaySummary = z
  .strictObject({
    date: LocalDate,
    tasks: z.strictObject({
      done: z.array(Task).openapi({ description: "Completed that day." }),
      pending: z.array(Task).openapi({ description: "Open and due that day." }),
      overdue: z.array(Task).openapi({ description: "Open and due before that day." }),
    }),
    habits: z.array(HabitProgress),
    sleep: orNull(SleepLog).openapi({ description: "The night that ended that morning." }),
    review: orNull(DayReview),
  })
  .openapi("DaySummary");

// ---------- history & metrics ----------

export const HistoryDay = z
  .strictObject({
    date: LocalDate,
    tasksDone: z.int(),
    habitsMet: z.int(),
    habitsTotal: z.int().openapi({ description: "Active daily habits that day." }),
    sleepMinutes: z.int().nullable(),
    mood: z.int().nullable(),
    reviewed: z.boolean(),
  })
  .openapi("HistoryDay");

export const History = z
  .strictObject({ month: z.string(), days: z.array(HistoryDay) })
  .openapi("History", { description: "Every day of the month up to today." });

const Rate = z.number().min(0).max(1).nullable();

export const Metrics = z
  .strictObject({
    range: z.enum(["week", "month", "year"]),
    from: LocalDate,
    to: LocalDate,
    tasks: z.strictObject({
      done: z.int(),
      created: z.int(),
      onTime: z.int().openapi({ description: "Done on or before their due date." }),
      withDue: z.int().openapi({ description: "Done tasks that had a due date." }),
      onTimeRate: Rate,
      buckets: z.array(z.strictObject({ start: LocalDate, label: z.string(), done: z.int() })).openapi({
        description: "Per day (week, month) or per month (year).",
      }),
    }),
    habits: z.array(z.strictObject({ id: Uuid, name: z.string(), targetPeriod: HabitPeriod, met: z.int(), total: z.int(), rate: Rate })),
    sleep: z.strictObject({
      nights: z.int(),
      avgMinutes: z.int().nullable(),
      avgBedTime: z.string().nullable().openapi({ description: "`HH:mm`." }),
      avgWakeTime: z.string().nullable(),
      avgQuality: z.number().nullable(),
    }),
    mood: z.strictObject({ days: z.int(), avg: z.number().nullable() }),
    sources: z
      .strictObject({ user: z.int(), sunday: z.int() })
      .openapi({ description: "Tasks, reminders and events created in the range, by who created them." }),
  })
  .openapi("Metrics");

export const MetricsQuery = z
  .strictObject({
    range: z.enum(["week", "month", "year"]).optional().openapi({ description: "Default `week`." }),
    date: LocalDate.optional().openapi({ description: "Any day inside the period (default today)." }),
  })
  .openapi("MetricsQuery");

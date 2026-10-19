import { Actor, BlockTime, ExpectedVersion, LocalDate, LocalTime, Mutable, orNull, Timestamp, Uuid } from "./common";
import { BlockType, CallOutcome, HabitLog, Review, Task, TaskKind, WeeklyGym } from "./planning";
import { SleepLog } from "./sleep";
import { z } from "./zod";

// ---------- habits ----------

export const HabitKind = z.enum(["boolean", "numeric"]).openapi("HabitKind");
export const HabitPeriod = z.enum(["day", "week"]).openapi("HabitPeriod");
const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(40)
  .openapi({ description: "Stable key the agent uses, e.g. `gym`.", example: "gym" });

export const Habit = z
  .strictObject({
    id: Uuid,
    slug: Slug,
    name: z.string(),
    kind: HabitKind,
    unit: z.string().nullable(),
    targetCount: z.int(),
    targetPeriod: HabitPeriod,
    blockType: orNull(BlockType).openapi({
      description: "Marking a block of this type done logs this habit for that date.",
    }),
    active: z.boolean(),
    order: z.int(),
    ...Mutable,
  })
  .openapi("Habit");

export const HabitProgress = z
  .strictObject({
    ...Habit.shape,
    streak: z
      .strictObject({ current: z.int(), best: z.int(), unit: HabitPeriod })
      .openapi({ description: "Consecutive days (daily habits) or ISO weeks Mon–Sun (weekly habits) meeting the target. The current period does not break the streak until it ends." }),
    period: z.strictObject({
      start: LocalDate,
      end: LocalDate,
      count: z.number().openapi({ description: "Days done in the period (boolean) or sum of values (numeric)." }),
      target: z.int(),
      met: z.boolean(),
    }),
    today: orNull(HabitLog),
  })
  .openapi("HabitProgress");

export const HabitCreate = z
  .strictObject({
    slug: Slug,
    name: z.string().min(1).max(100),
    kind: HabitKind,
    unit: z.string().max(20).nullable().optional(),
    targetCount: z.int().min(1).max(10000),
    targetPeriod: HabitPeriod,
    blockType: orNull(BlockType).optional(),
    active: z.boolean().optional(),
    order: z.int().min(0).optional(),
  })
  .refine((h) => !h.unit || h.kind === "numeric", { path: ["unit"], message: "Only numeric habits have a unit" })
  .openapi("HabitCreate");

export const HabitPatch = z
  .strictObject({
    name: z.string().min(1).max(100).optional(),
    unit: z.string().max(20).nullable().optional(),
    targetCount: z.int().min(1).max(10000).optional(),
    targetPeriod: HabitPeriod.optional(),
    blockType: orNull(BlockType).optional(),
    active: z.boolean().optional(),
    order: z.int().min(0).optional(),
    version: ExpectedVersion,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), "At least one field to change is required")
  .openapi("HabitPatch", { description: "`slug` and `kind` are immutable." });

export const HabitLogUpsert = z
  .strictObject({
    date: LocalDate,
    done: z.boolean(),
    value: z.number().min(0).max(1_000_000).nullable().optional().openapi({ description: "Numeric habits only." }),
    version: ExpectedVersion,
  })
  .openapi("HabitLogUpsert", {
    description: "Upsert by (habit, date). The agent may write only when no log exists or the existing one is its own.",
  });

// ---------- tasks ----------

export const TaskCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated UUIDv7 (offline creates)." }),
    date: LocalDate,
    title: z.string().min(1).max(500),
    kind: TaskKind.optional(),
    relatedBlockId: orNull(Uuid).optional(),
    order: z.int().min(0).optional(),
  })
  .openapi("TaskCreate");

export const TaskPatch = z
  .strictObject({
    title: z.string().min(1).max(500).optional(),
    kind: TaskKind.optional(),
    done: z.boolean().optional(),
    relatedBlockId: orNull(Uuid).optional(),
    order: z.int().min(0).optional(),
    date: LocalDate.optional().openapi({ description: "Move the task to another day." }),
    version: ExpectedVersion,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), "At least one field to change is required")
  .openapi("TaskPatch", {
    description: "The agent cannot edit or delete my tasks (origin=user) except marking them done while not done.",
  });

// ---------- metrics ----------

const Rate = z.number().min(0).max(1).nullable();

export const Metrics = z
  .strictObject({
    range: z.enum(["week", "month", "year"]),
    from: LocalDate,
    to: LocalDate,
    gym: z.strictObject({
      habitSlug: z.string().nullable(),
      weeks: z.array(z.strictObject({ weekStart: LocalDate, count: z.int(), target: z.int().nullable() })),
      total: z.int(),
    }),
    reading: z.strictObject({ habitSlug: z.string().nullable(), days: z.int(), totalDays: z.int() }),
    blocks: z.strictObject({
      total: z.int(),
      done: z.int(),
      skipped: z.int(),
      pending: z.int(),
      doneRate: Rate,
      byType: z.array(
        z.strictObject({ type: BlockType, total: z.int(), done: z.int(), skipped: z.int(), doneRate: Rate }),
      ),
    }),
    calls: z.strictObject({
      total: z.int(),
      perDay: z.array(z.strictObject({ date: LocalDate, count: z.int() })),
      outcomes: z.strictObject({
        closed_won: z.int(),
        follow_up: z.int(),
        no_show: z.int(),
        rescheduled: z.int(),
        lost: z.int(),
        unset: z.int(),
      }),
      showUpRate: Rate.openapi({ description: "(calls with outcome − no_show − rescheduled) / (calls with outcome − rescheduled)." }),
      closeRate: Rate.openapi({ description: "closed_won / calls that showed up." }),
    }),
    sleep: z.strictObject({
      nightsLogged: z.int().openapi({ description: "Nights with both bed and wake times." }),
      nightsTotal: z.int(),
      avgDurationMinutes: z.int().nullable(),
      avgBedtime: orNull(BlockTime).openapi({ description: "Average bedtime, `24:xx` when after midnight." }),
      avgWakeTime: orNull(LocalTime),
      avgBedDelayMinutes: z.int().nullable().openapi({ description: "Average bedtime vs planned `sleep` block start." }),
      nights: z.array(
        z.strictObject({ date: LocalDate, durationMinutes: z.int().nullable(), bedDelayMinutes: z.int().nullable() }),
      ),
    }),
    habits: z.array(
      z.strictObject({
        slug: z.string(),
        name: z.string(),
        currentStreak: z.int(),
        bestStreak: z.int(),
        periodsMet: z.int(),
        periodsTotal: z.int(),
      }),
    ),
  })
  .openapi("Metrics", {
    description:
      "Computed over closed + current days of the chosen option (option A if never chosen). Gym and reading come from the habits linked to block types `gym` / `reading`.",
  });

// ---------- agent context ----------

export const AgentContext = z
  .strictObject({
    date: LocalDate,
    weekStart: LocalDate,
    weeklyGym: orNull(z.strictObject({ ...WeeklyGym.shape, source: z.enum(["habit", "agent_report"]) })),
    habitsPendingToday: z.array(
      z.strictObject({
        slug: z.string(),
        name: z.string(),
        kind: HabitKind,
        periodCount: z.number(),
        periodTarget: z.int(),
        targetPeriod: HabitPeriod,
      }),
    ),
    streaksAtRisk: z.array(
      z.strictObject({
        slug: z.string(),
        name: z.string(),
        currentStreak: z.int(),
        reason: z.enum(["not_done_today", "week_target_unreachable_soon"]),
        remainingInPeriod: z.number().openapi({ description: "Sessions/units still needed in the current period." }),
      }),
    ),
    yesterday: z
      .strictObject({
        date: LocalDate,
        status: z.enum(["draft", "chosen", "edited", "closed"]),
        completion: Rate,
        blocksDone: z.int(),
        blocksTotal: z.int(),
        unfinishedTasks: z.array(Task),
      })
      .nullable(),
    lastReview: orNull(z.strictObject({ date: LocalDate, ...Review.shape })),
    lastNightSleep: orNull(SleepLog).openapi({ description: "Night before `date` (may be incomplete)." }),
    skippedPatterns: z
      .array(
        z.strictObject({
          type: BlockType,
          hour: LocalTime.openapi({ description: "Start hour bucket, e.g. `07:00` = 07:00–07:59." }),
          skipped: z.int(),
          total: z.int(),
        }),
      )
      .openapi({
        description:
          "Agent blocks of the same type and start hour skipped ≥ 3 times and in ≥ 50 % of occurrences over the last 14 days.",
      }),
    pendingProposal: z.strictObject({ id: Uuid, createdAt: Timestamp }).nullable(),
  })
  .openapi("AgentContext", { description: "Compact planning context for the agent's 07:00 run." });

// ---------- changelog ----------

export const ChangeAction = z
  .enum(["create", "update", "delete", "replace", "choose", "close", "propose", "accept", "reject", "shift"])
  .openapi("ChangeAction");

export const ChangeLogEntry = z
  .strictObject({
    id: Uuid,
    actor: Actor,
    entity: z.string(),
    entityId: orNull(Uuid),
    date: orNull(LocalDate),
    action: ChangeAction,
    diff: z.unknown(),
    forced: z.boolean(),
    requestId: z.string(),
    at: Timestamp,
  })
  .openapi("ChangeLogEntry");

// ---------- webhook to Agenbot ----------

export const WebhookChange = z
  .strictObject({
    entity: z.enum(["day", "block", "task", "habit_log", "proposal", "sleep_log"]),
    id: Uuid,
    action: ChangeAction,
    fields: z.record(z.string(), z.strictObject({ from: z.unknown(), to: z.unknown() })).optional(),
    block: z
      .strictObject({ title: z.string(), type: BlockType, start: BlockTime, externalId: z.string().nullable(), outcome: orNull(CallOutcome).optional() })
      .optional(),
    task: z.strictObject({ title: z.string(), kind: TaskKind }).optional(),
    habit: z.strictObject({ slug: z.string(), name: z.string() }).optional(),
    shift: z
      .strictObject({
        fromTime: BlockTime,
        minutes: z.int(),
        blocks: z.array(z.strictObject({ id: Uuid, title: z.string(), from: BlockTime, to: BlockTime })),
      })
      .optional()
      .openapi({ description: "On `action: shift` (\"Me atrasé\")." }),
    sleep: z
      .strictObject({ night: LocalDate, bedAt: orNull(Timestamp), wokeAt: orNull(Timestamp) })
      .optional(),
    at: Timestamp,
  })
  .openapi("WebhookChange");

export const WebhookPayload = z
  .strictObject({
    event: z.literal("day.updated_by_user"),
    batchId: Uuid,
    date: LocalDate,
    dayVersion: z.int(),
    changes: z.array(WebhookChange).min(1),
    summary: z.strictObject({
      blocksDone: z.int(),
      blocksTotal: z.int(),
      weeklyGym: orNull(WeeklyGym),
    }),
    dayUrl: z.url(),
  })
  .openapi("WebhookPayload");

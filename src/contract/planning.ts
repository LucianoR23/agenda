import { ExpectedVersion, LocalDate, BlockTime, Mutable, OptionLabel, orNull, Timestamp, Uuid } from "./common";
import { DaySleep } from "./sleep";
import { z } from "./zod";

// ---------- enums ----------

export const DayStatus = z.enum(["draft", "chosen", "edited", "closed"]).openapi("DayStatus");
export const BlockType = z
  .enum([
    "call",
    "meeting",
    "routine",
    "gym",
    "meal",
    "reading",
    "study",
    "dogs",
    "partner",
    "sleep",
    "local_work",
    "padel",
    "other",
  ])
  .openapi("BlockType");
export const BlockSource = z.enum(["calendar", "agent", "user"]).openapi("BlockSource");
export const CalendarKind = z.enum(["work", "personal"]).openapi("CalendarKind");
export const BlockStatus = z.enum(["pending", "done", "skipped"]).openapi("BlockStatus");
export const CallOutcome = z
  .enum(["closed_won", "follow_up", "no_show", "rescheduled", "lost"])
  .openapi("CallOutcome");
export const ScheduleField = z
  .enum(["start", "end", "title", "type", "detail", "lead", "order"])
  .openapi("ScheduleField");
export const ProposalStatus = z
  .enum(["pending", "accepted", "rejected", "superseded"])
  .openapi("ProposalStatus");

// ---------- value objects ----------

export const Lead = z
  .strictObject({
    name: z.string().min(1).max(200),
    phone: z.string().max(40).optional().openapi({ example: "+5491155550101" }),
    whatsapp: z
      .string()
      .regex(/^\d{8,15}$/, "Digits only, international format without +")
      .optional()
      .openapi({ description: "Number for `https://wa.me/<whatsapp>`.", example: "5491155550101" }),
    notes: z.string().max(4000).optional(),
    crmUrl: z.url().optional(),
  })
  .openapi("Lead", { description: "Lead context; only on `call` blocks." });

export const WeeklyGym = z
  .strictObject({ done: z.int().min(0).max(14), target: z.int().min(1).max(14) })
  .openapi("WeeklyGym", { description: "Gym sessions this week as reported by the agent." });

export const Review = z
  .strictObject({
    energy: z.int().min(1).max(5),
    mood: z.int().min(1).max(5),
    text: z.string().max(4000).nullable().optional(),
  })
  .openapi("Review", { description: "End-of-day review." });

// ---------- blocks ----------

const blockScheduleShape = {
  start: BlockTime,
  end: orNull(BlockTime).optional().openapi({
    description: "Optional end. `end < start` means the block ends after midnight.",
  }),
  title: z.string().min(1).max(200),
  type: BlockType,
  detail: z.string().max(4000).nullable().optional(),
  lead: orNull(Lead).optional(),
  order: z.int().min(0).optional().openapi({ description: "Tie-breaker for blocks with the same start." }),
};

const calendarShape = {
  externalId: z.string().min(1).max(1024).nullable().optional().openapi({
    description: "Google Calendar event id. Required when `source=calendar`.",
  }),
  externalUrl: z.url().nullable().optional().openapi({ description: "Google Calendar event link." }),
  calendar: orNull(CalendarKind).optional(),
};

export const Block = z
  .strictObject({
    id: Uuid,
    optionId: Uuid,
    start: BlockTime,
    end: orNull(BlockTime),
    title: z.string(),
    type: BlockType,
    detail: z.string().nullable(),
    lead: orNull(Lead),
    source: BlockSource,
    externalId: z.string().nullable(),
    externalUrl: z.string().nullable(),
    calendar: orNull(CalendarKind),
    removedFromCalendarAt: orNull(Timestamp).openapi({
      description: "Set when the event disappeared from Google after I tracked it (kept for history).",
    }),
    status: BlockStatus,
    statusAt: orNull(Timestamp),
    outcome: orNull(CallOutcome),
    note: z.string().nullable(),
    locked: z.boolean(),
    remind: z.boolean().openapi({ description: "Push 10 min before start (\"Avisarme 10 min antes\"). Mine; default true for calls." }),
    userOverrides: z.array(ScheduleField).openapi({
      description: "Schedule fields I edited; the agent cannot change them until the day closes.",
    }),
    order: z.int(),
    ...Mutable,
  })
  .openapi("Block");

/** Block as sent by the agent inside a full-day PUT. */
export const BlockInput = z
  .strictObject({
    id: Uuid.optional().openapi({
      description: "Existing block id, to match agent blocks across replaces. Calendar blocks match by `externalId`.",
    }),
    source: z.enum(["calendar", "agent"]),
    ...blockScheduleShape,
    ...calendarShape,
  })
  .superRefine(refineBlock)
  .openapi("BlockInput");

export const BlockCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated UUIDv7 (offline creates)." }),
    source: BlockSource.optional().openapi({
      description: "Defaults to the actor (`agent` | `user`). Only the agent may create `calendar` blocks.",
    }),
    ...blockScheduleShape,
    ...calendarShape,
    locked: z.boolean().optional().openapi({ description: "User only." }),
    remind: z.boolean().optional().openapi({ description: "Default: true for calls, false otherwise." }),
  })
  .superRefine(refineBlock)
  .openapi("BlockCreate");

export const BlockPatch = z
  .strictObject({
    start: BlockTime.optional(),
    end: orNull(BlockTime).optional(),
    title: z.string().min(1).max(200).optional(),
    type: BlockType.optional(),
    detail: z.string().max(4000).nullable().optional(),
    lead: orNull(Lead).optional(),
    order: z.int().min(0).optional(),
    status: BlockStatus.optional(),
    outcome: orNull(CallOutcome).optional(),
    note: z.string().max(4000).nullable().optional(),
    locked: z.boolean().optional().openapi({ description: "User only." }),
    remind: z.boolean().optional().openapi({ description: "Mine; the agent may not change it." }),
    version: ExpectedVersion,
    force: z.boolean().optional().openapi({
      description:
        "Agent only: overwrite fields listed in `userOverrides`. Not allowed on `locked` blocks. Logged.",
    }),
  })
  .refine(
    (b) => Object.keys(b).some((k) => k !== "version" && k !== "force"),
    "At least one field to change is required",
  )
  .openapi("BlockPatch");

export const BlockExternalPatch = z
  .strictObject({
    start: BlockTime.optional(),
    end: orNull(BlockTime).optional(),
    title: z.string().min(1).max(200).optional(),
    type: BlockType.optional(),
    detail: z.string().max(4000).nullable().optional(),
    lead: orNull(Lead).optional(),
    externalUrl: z.url().nullable().optional(),
    calendar: orNull(CalendarKind).optional(),
    status: BlockStatus.optional(),
    outcome: orNull(CallOutcome).optional(),
    note: z.string().max(4000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "At least one field to change is required")
  .openapi("BlockExternalPatch", {
    description:
      "Agent mirror of a Google Calendar change. Applied to every copy of the event (all options). No `version`: the agent always writes the latest calendar state.",
  });

function refineBlock(
  b: { source?: string; type: string; externalId?: string | null; lead?: unknown },
  ctx: z.RefinementCtx,
) {
  if (b.source === "calendar" && !b.externalId)
    ctx.addIssue({ code: "custom", path: ["externalId"], message: "Required when source is calendar" });
  if (b.source !== "calendar" && b.externalId)
    ctx.addIssue({ code: "custom", path: ["externalId"], message: "Only calendar blocks have externalId" });
  if (b.lead && b.type !== "call")
    ctx.addIssue({ code: "custom", path: ["lead"], message: "Only call blocks have a lead" });
}

// ---------- options ----------

export const PlanOption = z
  .strictObject({
    id: Uuid,
    label: OptionLabel,
    title: z.string(),
    description: z.string().nullable(),
    order: z.int(),
    blocks: z.array(Block).openapi({ description: "Sorted by `start`, then `order`." }),
    ...Mutable,
  })
  .openapi("PlanOption");

export const PlanOptionInput = z
  .strictObject({
    label: OptionLabel,
    title: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    blocks: z.array(BlockInput).max(80),
  })
  .superRefine((o, ctx) => {
    const seen = new Set<string>();
    o.blocks.forEach((b, i) => {
      if (!b.externalId) return;
      if (seen.has(b.externalId))
        ctx.addIssue({ code: "custom", path: ["blocks", i, "externalId"], message: "Duplicate externalId in option" });
      seen.add(b.externalId);
    });
  })
  .openapi("PlanOptionInput");

// ---------- tasks (embedded in day) ----------

export const TaskKind = z
  .enum(["whatsapp_confirm", "lead_context", "follow_up", "other"])
  .openapi("TaskKind");
export const TaskOrigin = z.enum(["agent", "user"]).openapi("TaskOrigin");

export const Task = z
  .strictObject({
    id: Uuid,
    date: LocalDate,
    title: z.string(),
    kind: TaskKind,
    origin: TaskOrigin,
    done: z.boolean(),
    doneAt: orNull(Timestamp),
    relatedBlockId: orNull(Uuid),
    order: z.int(),
    ...Mutable,
  })
  .openapi("Task");

export const DayTaskInput = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Existing agent task id; otherwise matched by `kind` + `title`." }),
    title: z.string().min(1).max(500),
    kind: TaskKind.optional(),
    relatedExternalId: z.string().optional().openapi({
      description: "Links the task to the calendar block with this `externalId` (chosen option, or option A in draft).",
    }),
    order: z.int().min(0).optional(),
  })
  .openapi("DayTaskInput");

// ---------- habit log (embedded in day) ----------

export const HabitLog = z
  .strictObject({
    id: Uuid,
    habitId: Uuid,
    habitSlug: z.string(),
    date: LocalDate,
    done: z.boolean(),
    value: z.number().nullable(),
    source: z.enum(["agent", "user"]),
    ...Mutable,
  })
  .openapi("HabitLog");

// ---------- proposals ----------

export const BlockRef = z
  .strictObject({
    id: orNull(Uuid).openapi({ description: "Null for blocks that do not exist yet (added)." }),
    externalId: z.string().nullable(),
    title: z.string(),
    type: BlockType,
    start: BlockTime,
    end: orNull(BlockTime),
  })
  .openapi("BlockRef");

export const ProposalDiff = z
  .strictObject({
    option: OptionLabel.openapi({ description: "Diff is computed against my chosen option." }),
    added: z.array(BlockRef),
    removed: z.array(BlockRef),
    keptRemovedFromCalendar: z.array(BlockRef).openapi({
      description: "Calendar blocks gone from Google but kept because I already tracked them.",
    }),
    moved: z.array(
      z.strictObject({
        block: BlockRef,
        from: z.strictObject({ start: BlockTime, end: orNull(BlockTime) }),
        to: z.strictObject({ start: BlockTime, end: orNull(BlockTime) }),
      }),
    ),
    changed: z.array(
      z.strictObject({
        block: BlockRef,
        fields: z.record(z.string(), z.strictObject({ from: z.unknown(), to: z.unknown() })),
      }),
    ),
    preservedOverrides: z.array(
      z.strictObject({ block: BlockRef, fields: z.array(ScheduleField) }),
    ).openapi({ description: "Agent changes that will be ignored because I edited those fields." }),
    dayFields: z.record(z.string(), z.strictObject({ from: z.unknown(), to: z.unknown() })),
  })
  .openapi("ProposalDiff");

// DayInput is referenced lazily to avoid a cycle with Proposal.payload
export const DayInput = z
  .strictObject({
    notes: z.string().max(4000).nullable().optional(),
    callsSummary: z.string().max(4000).nullable().optional(),
    weeklyGym: orNull(WeeklyGym).optional(),
    reason: z.string().max(1000).optional().openapi({
      description: "Why the agent is replacing the plan; shown in the proposal banner.",
    }),
    options: z.array(PlanOptionInput).min(1).max(5),
    tasks: z.array(DayTaskInput).max(100).optional().openapi({
      description:
        "Agent checklist for the day. When present, agent-origin tasks for the date are synced (matched by `id`, then `kind`+`title`); unmatched ones are deleted unless done. My tasks are never touched. Applied immediately, even when the rest of the body becomes a proposal.",
    }),
  })
  .superRefine((d, ctx) => {
    const labels = d.options.map((o) => o.label);
    labels.forEach((l, i) => {
      if (labels.indexOf(l) !== i)
        ctx.addIssue({ code: "custom", path: ["options", i, "label"], message: "Duplicate option label" });
    });
  })
  .openapi("DayInput", { description: "Full day body sent by the agent (`PUT /api/days/{date}`)." });

export const Proposal = z
  .strictObject({
    id: Uuid,
    date: LocalDate,
    status: ProposalStatus,
    reason: z.string().nullable(),
    baseDayVersion: z.int(),
    createdAt: Timestamp,
    resolvedAt: orNull(Timestamp),
    diff: ProposalDiff,
    payload: DayInput,
  })
  .openapi("Proposal");

// ---------- day ----------

export const Day = z
  .strictObject({
    id: Uuid,
    date: LocalDate,
    status: DayStatus,
    chosenOptionId: orNull(Uuid),
    chosenOption: orNull(OptionLabel),
    notes: z.string().nullable(),
    callsSummary: z.string().nullable(),
    weeklyGym: orNull(WeeklyGym),
    review: orNull(Review),
    reviewedAt: orNull(Timestamp),
    closedAt: orNull(Timestamp),
    options: z.array(PlanOption),
    tasks: z.array(Task),
    habitLogs: z.array(HabitLog),
    pendingProposal: orNull(Proposal),
    sleep: DaySleep,
    ...Mutable,
  })
  .openapi("Day", {
    description: "Full day. `version` (and the `ETag`) change on any write to the day, its options or its blocks.",
  });

export const DayPatch = z
  .strictObject({
    notes: z.string().max(4000).nullable().optional(),
    callsSummary: z.string().max(4000).nullable().optional(),
    weeklyGym: orNull(WeeklyGym).optional(),
    review: orNull(Review).optional().openapi({ description: "Mine; the agent may set it only while unset." }),
    status: z.literal("closed").optional().openapi({
      description: "User only: close the day early. Other transitions go through `choose`, block edits and the close job.",
    }),
    version: ExpectedVersion,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), "At least one field to change is required")
  .openapi("DayPatch");

export const ChooseInput = z
  .strictObject({ option: OptionLabel, version: ExpectedVersion })
  .openapi("ChooseInput");

export const ShiftInput = z
  .strictObject({
    fromTime: BlockTime.openapi({ description: "Shift blocks starting at or after this time.", example: "21:00" }),
    minutes: z
      .int()
      .min(-240)
      .max(240)
      .refine((m) => m !== 0, "Must not be 0")
      .openapi({ example: 30 }),
    version: ExpectedVersion,
  })
  .openapi("ShiftInput", {
    description:
      "\"Me atrasé\": shifts my pending, unlocked agent/user blocks of the chosen option (including `sleep`). Calendar blocks are untouched. Blocks may move past midnight (`24:15`); nothing is lost and the shift is recorded as a `shift` ChangeLog entry and webhook change. 422 `shift_out_of_range` only if a start would leave 00:00–29:59.",
  });

export const ReorderInput = z
  .strictObject({
    ids: z.array(Uuid).min(1).max(80).openapi({
      description: "Agent/user block ids of one option, in the new order. Calendar blocks → 409 `calendar_owned`.",
    }),
    version: ExpectedVersion,
  })
  .openapi("ReorderInput");

export const DaySummary = z
  .strictObject({
    date: LocalDate,
    status: DayStatus,
    chosenOption: orNull(OptionLabel),
    blocksTotal: z.int(),
    blocksDone: z.int(),
    blocksSkipped: z.int(),
    completion: z.number().min(0).max(1).nullable().openapi({
      description: "done / total of the chosen option (option A if never chosen); null when no blocks.",
    }),
    callsTotal: z.int(),
    review: orNull(Review),
    hasPendingProposal: z.boolean(),
    version: z.int(),
  })
  .openapi("DaySummary");

export const PutDayResult = z
  .strictObject({
    result: z.enum(["created", "replaced", "proposed"]),
    day: Day,
    proposal: orNull(Proposal),
  })
  .openapi("PutDayResult");

export type DayInputBody = z.infer<typeof DayInput>;

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { HHMM_REGEX, createdAt, id, mutable } from "./common";

export const dayStatusEnum = pgEnum("day_status", ["draft", "chosen", "edited", "closed"]);

export const blockTypeEnum = pgEnum("block_type", [
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
]);

export const blockSourceEnum = pgEnum("block_source", ["calendar", "agent", "user"]);
export const calendarKindEnum = pgEnum("calendar_kind", ["work", "personal"]);
export const blockStatusEnum = pgEnum("block_status", ["pending", "done", "skipped"]);
export const callOutcomeEnum = pgEnum("call_outcome", [
  "closed_won",
  "follow_up",
  "no_show",
  "rescheduled",
  "lost",
]);
export const proposalStatusEnum = pgEnum("proposal_status", [
  "pending",
  "accepted",
  "rejected",
  "superseded",
]);

/** Schedule fields of a block; the only values allowed in `block.user_overrides`. */
export const SCHEDULE_FIELDS = ["start", "end", "title", "type", "detail", "lead", "order"] as const;
export type ScheduleField = (typeof SCHEDULE_FIELDS)[number];

export type Lead = {
  name: string;
  phone?: string;
  whatsapp?: string;
  notes?: string;
  crmUrl?: string;
};

export const day = pgTable(
  "day",
  {
    id: id(),
    date: date({ mode: "string" }).notNull().unique("day_date_uq"),
    status: dayStatusEnum().notNull().default("draft"),
    chosenOptionId: uuid().references((): AnyPgColumn => planOption.id, { onDelete: "set null" }),
    notes: text(),
    callsSummary: text(),
    // weeklyGym as reported by the agent
    weeklyGymDone: smallint(),
    weeklyGymTarget: smallint(),
    // end-of-day review
    reviewEnergy: smallint(),
    reviewMood: smallint(),
    reviewText: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    check(
      "day_chosen_requires_option",
      sql`${t.status} NOT IN ('chosen', 'edited') OR ${t.chosenOptionId} IS NOT NULL`,
    ),
    check("day_closed_has_closed_at", sql`(${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`),
    check(
      "day_weekly_gym_pair",
      sql`(${t.weeklyGymDone} IS NULL) = (${t.weeklyGymTarget} IS NULL)
        AND (${t.weeklyGymDone} IS NULL OR (${t.weeklyGymDone} >= 0 AND ${t.weeklyGymTarget} > 0))`,
    ),
    check(
      "day_review_complete",
      sql`(${t.reviewEnergy} IS NULL) = (${t.reviewMood} IS NULL)
        AND (${t.reviewText} IS NULL OR ${t.reviewEnergy} IS NOT NULL)`,
    ),
    check("day_review_energy_range", sql`${t.reviewEnergy} BETWEEN 1 AND 5`),
    check("day_review_mood_range", sql`${t.reviewMood} BETWEEN 1 AND 5`),
    index("day_status_idx").on(t.status),
  ],
);

export const planOption = pgTable(
  "plan_option",
  {
    id: id(),
    dayId: uuid()
      .notNull()
      .references(() => day.id, { onDelete: "cascade" }),
    label: text().notNull(),
    title: text().notNull(),
    description: text(),
    order: integer().notNull().default(0),
    ...mutable(),
  },
  (t) => [
    unique("plan_option_day_label_uq").on(t.dayId, t.label),
    // target for block's composite FK, guarantees block.day_id matches its option's day
    unique("plan_option_id_day_uq").on(t.id, t.dayId),
    check("plan_option_label_format", sql`${t.label} ~ '^[A-Z]$'`),
  ],
);

export const block = pgTable(
  "block",
  {
    id: id(),
    optionId: uuid().notNull(),
    // denormalized from the option for day-wide queries (by-external, metrics)
    dayId: uuid()
      .notNull()
      .references(() => day.id, { onDelete: "cascade" }),
    start: text().notNull(),
    end: text(),
    title: text().notNull(),
    type: blockTypeEnum().notNull(),
    detail: text(),
    lead: jsonb().$type<Lead>(),
    source: blockSourceEnum().notNull(),
    externalId: text(),
    externalUrl: text(),
    calendar: calendarKindEnum(),
    status: blockStatusEnum().notNull().default("pending"),
    statusAt: timestamp({ withTimezone: true }),
    outcome: callOutcomeEnum(),
    note: text(),
    locked: boolean().notNull().default(false),
    userOverrides: text()
      .array()
      .$type<ScheduleField[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    order: integer().notNull().default(0),
    ...mutable(),
  },
  (t) => [
    foreignKey({
      name: "block_option_fk",
      columns: [t.optionId, t.dayId],
      foreignColumns: [planOption.id, planOption.dayId],
    }).onDelete("cascade"),
    // the same calendar event appears once per option
    uniqueIndex("block_option_external_uq")
      .on(t.optionId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("block_day_external_idx").on(t.dayId, t.externalId),
    index("block_option_order_idx").on(t.optionId, t.order),
    check("block_start_format", sql`${t.start} ~ '${sql.raw(HHMM_REGEX)}'`),
    check("block_end_format", sql`${t.end} IS NULL OR ${t.end} ~ '${sql.raw(HHMM_REGEX)}'`),
    check(
      "block_calendar_requires_external_id",
      sql`${t.source} <> 'calendar' OR ${t.externalId} IS NOT NULL`,
    ),
    check("block_outcome_only_calls", sql`${t.outcome} IS NULL OR ${t.type} = 'call'`),
    check("block_lead_only_calls", sql`${t.lead} IS NULL OR ${t.type} = 'call'`),
    check(
      "block_user_overrides_values",
      sql`${t.userOverrides} <@ ARRAY['start','end','title','type','detail','lead','order']::text[]`,
    ),
  ],
);

export const proposal = pgTable(
  "proposal",
  {
    id: id(),
    dayId: uuid()
      .notNull()
      .references(() => day.id, { onDelete: "cascade" }),
    // full PUT /api/days/{date} body as sent by the agent
    payload: jsonb().notNull(),
    reason: text(),
    status: proposalStatusEnum().notNull().default("pending"),
    // day.version the agent's payload was compared against
    baseDayVersion: integer().notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("proposal_one_pending_per_day_uq")
      .on(t.dayId)
      .where(sql`${t.status} = 'pending'`),
    index("proposal_day_created_idx").on(t.dayId, t.createdAt),
  ],
);

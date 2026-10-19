import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { id, mutable } from "./common";
import { block, blockTypeEnum } from "./planning";

export const habitKindEnum = pgEnum("habit_kind", ["boolean", "numeric"]);
export const habitPeriodEnum = pgEnum("habit_period", ["day", "week"]);
export const habitLogSourceEnum = pgEnum("habit_log_source", ["agent", "user"]);
export const taskKindEnum = pgEnum("task_kind", [
  "whatsapp_confirm",
  "lead_context",
  "follow_up",
  "other",
]);
export const taskOriginEnum = pgEnum("task_origin", ["agent", "user"]);

export const habit = pgTable(
  "habit",
  {
    id: id(),
    // stable machine key so the agent can address habits ("gym", "reading")
    slug: text().notNull().unique("habit_slug_uq"),
    name: text().notNull(),
    kind: habitKindEnum().notNull(),
    unit: text(),
    targetCount: integer().notNull(),
    targetPeriod: habitPeriodEnum().notNull(),
    // optional link: marking a block of this type done logs the habit for that date
    blockType: blockTypeEnum(),
    active: boolean().notNull().default(true),
    order: integer().notNull().default(0),
    ...mutable(),
  },
  (t) => [
    check("habit_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("habit_target_positive", sql`${t.targetCount} > 0`),
    check("habit_unit_only_numeric", sql`${t.unit} IS NULL OR ${t.kind} = 'numeric'`),
  ],
);

export const habitLog = pgTable(
  "habit_log",
  {
    id: id(),
    habitId: uuid()
      .notNull()
      .references(() => habit.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    done: boolean().notNull(),
    value: numeric({ precision: 12, scale: 2, mode: "number" }),
    source: habitLogSourceEnum().notNull(),
    ...mutable(),
  },
  (t) => [
    unique("habit_log_habit_date_uq").on(t.habitId, t.date),
    index("habit_log_date_idx").on(t.date),
  ],
);

export const task = pgTable(
  "task",
  {
    id: id(),
    date: date({ mode: "string" }).notNull(),
    title: text().notNull(),
    kind: taskKindEnum().notNull().default("other"),
    origin: taskOriginEnum().notNull(),
    done: boolean().notNull().default(false),
    doneAt: timestamp({ withTimezone: true }),
    relatedBlockId: uuid().references(() => block.id, { onDelete: "set null" }),
    order: integer().notNull().default(0),
    ...mutable(),
  },
  (t) => [
    index("task_date_order_idx").on(t.date, t.order),
    check("task_done_at_consistent", sql`${t.done} = (${t.doneAt} IS NOT NULL)`),
  ],
);

/**
 * Actual sleep for the night that starts on `date` (bedtime on `date` evening or after midnight,
 * wake-up the next morning). Each half has its own source so ownership works per field:
 * the agent may only fill a half that is still empty.
 */
export const sleepLog = pgTable(
  "sleep_log",
  {
    id: id(),
    date: date({ mode: "string" }).notNull().unique("sleep_log_date_uq"),
    bedAt: timestamp({ withTimezone: true }),
    bedSource: habitLogSourceEnum(),
    wokeAt: timestamp({ withTimezone: true }),
    wakeSource: habitLogSourceEnum(),
    note: text(),
    ...mutable(),
  },
  (t) => [
    check("sleep_log_bed_source", sql`(${t.bedAt} IS NULL) = (${t.bedSource} IS NULL)`),
    check("sleep_log_wake_source", sql`(${t.wokeAt} IS NULL) = (${t.wakeSource} IS NULL)`),
    check(
      "sleep_log_order",
      sql`${t.bedAt} IS NULL OR ${t.wokeAt} IS NULL
        OR (${t.wokeAt} > ${t.bedAt} AND ${t.wokeAt} - ${t.bedAt} < interval '20 hours')`,
    ),
  ],
);

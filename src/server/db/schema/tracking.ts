import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, itemSourceEnum, syncable, updatedAt } from "./common";

export const habitKindEnum = pgEnum("habit_kind", ["boolean", "numeric"]);
export const habitPeriodEnum = pgEnum("habit_period", ["day", "week"]);

/** A target to keep ("Gym 3 per week", "Read 20 pages a day"). Streaks are computed in domain code. */
export const habit = pgTable(
  "habit",
  {
    id: id(),
    /** Stable key Sunday can address ("gym", "reading"). */
    slug: text().notNull(),
    name: text().notNull(),
    kind: habitKindEnum().notNull(),
    unit: text(),
    targetCount: integer().notNull(),
    targetPeriod: habitPeriodEnum().notNull(),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("habit_active_slug_uq").on(t.slug).where(sql`${t.deletedAt} IS NULL`),
    check("habit_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("habit_target_positive", sql`${t.targetCount} > 0`),
    check("habit_unit_only_numeric", sql`${t.unit} IS NULL OR ${t.kind} = 'numeric'`),
  ],
);

/** One check-in per habit and local date (among live rows: a soft-deleted check-in can be redone). */
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
    source: itemSourceEnum().notNull(),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("habit_log_habit_date_uq").on(t.habitId, t.date).where(sql`${t.deletedAt} IS NULL`),
    index("habit_log_date_idx").on(t.date),
    index("habit_log_updated_idx").on(t.updatedAt),
  ],
);

/**
 * One night of sleep, keyed by the **wake-up date** (bed Wed 23:30 → up Thu 07:10 is Thursday's row), so "how did
 * I sleep" on Hoy, metrics, habits and the day review all look at the same date. Going to bed after noon counts
 * for the next day's row.
 */
export const sleepLog = pgTable(
  "sleep_log",
  {
    id: id(),
    date: date({ mode: "string" }).notNull(),
    bedAt: at(),
    wakeAt: at(),
    quality: smallint(),
    notes: text(),
    source: itemSourceEnum().notNull(),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("sleep_log_date_uq").on(t.date).where(sql`${t.deletedAt} IS NULL`),
    index("sleep_log_updated_idx").on(t.updatedAt),
    check("sleep_log_quality_range", sql`${t.quality} IS NULL OR ${t.quality} BETWEEN 1 AND 5`),
    check(
      "sleep_log_order",
      sql`${t.bedAt} IS NULL OR ${t.wakeAt} IS NULL OR (${t.wakeAt} > ${t.bedAt} AND ${t.wakeAt} - ${t.bedAt} < interval '20 hours')`,
    ),
  ],
);

/** "Cierre del día": one per local date. Versioned for offline conflicts; not soft-deletable (the date is the key). */
export const dayReview = pgTable(
  "day_review",
  {
    date: date({ mode: "string" }).primaryKey(),
    mood: smallint(),
    note: text(),
    highlights: text().array().notNull().default(sql`'{}'::text[]`),
    movedTaskIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    version: integer().notNull().default(1),
    updatedBy: itemSourceEnum().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("day_review_mood_range", sql`${t.mood} IS NULL OR ${t.mood} BETWEEN 1 AND 5`)],
);

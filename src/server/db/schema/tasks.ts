import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, smallint, text, time, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, id, itemSourceEnum, syncable } from "./common";

export const taskStatusEnum = pgEnum("task_status", ["open", "done", "cancelled"]);

/** A list of tasks. Exactly one active Inbox (seeded by migration 0001, can't be deleted). */
export const taskList = pgTable(
  "task_list",
  {
    id: id(),
    name: text().notNull(),
    color: text(),
    icon: text(),
    sortOrder: integer().notNull().default(0),
    isInbox: boolean().notNull().default(false),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("task_list_one_inbox_uq").on(t.isInbox).where(sql`${t.isInbox} AND ${t.deletedAt} IS NULL`),
    uniqueIndex("task_list_active_name_uq").on(sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`),
    check("task_list_inbox_not_deleted", sql`NOT (${t.isInbox} AND ${t.deletedAt} IS NOT NULL)`),
    check("task_list_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
  ],
);

/**
 * Something to do. Due date + optional local time are stored as a local intent ("Thursday at 9") and turned into
 * instants with the user's timezone when needed. A recurring task keeps its RRULE; completing it creates the next
 * occurrence in the same `series_id`.
 *
 * Search indexes (trigram over unaccented title/notes) live in migration 0001, not here.
 */
export const task = pgTable(
  "task",
  {
    id: id(),
    /** Caller-supplied idempotency handle (Sunday): the same client_id again updates instead of duplicating. */
    clientId: text(),
    listId: uuid()
      .notNull()
      .references(() => taskList.id, { onDelete: "restrict" }),
    title: text().notNull(),
    notes: text(),
    status: taskStatusEnum().notNull().default("open"),
    priority: smallint().notNull().default(0),
    dueDate: date({ mode: "string" }),
    dueTime: time(),
    rrule: text(),
    seriesId: uuid(),
    completedAt: at(),
    sortOrder: integer().notNull().default(0),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    source: itemSourceEnum().notNull(),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("task_client_id_uq").on(t.clientId),
    index("task_status_due_idx").on(t.status, t.dueDate).where(sql`${t.deletedAt} IS NULL`),
    index("task_list_order_idx").on(t.listId, t.sortOrder).where(sql`${t.deletedAt} IS NULL`),
    index("task_series_idx").on(t.seriesId).where(sql`${t.seriesId} IS NOT NULL`),
    index("task_tags_gin").using("gin", t.tags),
    index("task_updated_idx").on(t.updatedAt),
    check("task_priority_range", sql`${t.priority} BETWEEN 0 AND 3`),
    check("task_time_needs_date", sql`${t.dueTime} IS NULL OR ${t.dueDate} IS NOT NULL`),
    check("task_rrule_needs_date", sql`${t.rrule} IS NULL OR ${t.dueDate} IS NOT NULL`),
    check("task_completed_consistent", sql`(${t.status} = 'done') = (${t.completedAt} IS NOT NULL)`),
    check("task_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 500`),
    check("task_client_id_length", sql`${t.clientId} IS NULL OR char_length(${t.clientId}) BETWEEN 1 AND 100`),
  ],
);

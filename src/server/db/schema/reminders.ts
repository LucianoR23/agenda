import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, id, itemSourceEnum, syncable } from "./common";
import { event } from "./events";
import { task } from "./tasks";

export const reminderStatusEnum = pgEnum("reminder_status", ["scheduled", "sent", "done", "cancelled", "missed"]);

/**
 * A push at a moment: standalone, attached to a task, or materialized from an event's offset ("30 min before").
 * Recurring reminders keep `status = scheduled` and move `fire_at` to the next occurrence after each delivery.
 */
export const reminder = pgTable(
  "reminder",
  {
    id: id(),
    clientId: text(),
    title: text().notNull(),
    body: text(),
    fireAt: at().notNull(),
    rrule: text(),
    status: reminderStatusEnum().notNull().default("scheduled"),
    urgent: boolean().notNull().default(false),
    taskId: uuid().references(() => task.id, { onDelete: "set null" }),
    eventId: uuid().references(() => event.id, { onDelete: "cascade" }),
    /** Minutes before the event, when generated from `event.reminder_offsets`. */
    offsetMinutes: integer(),
    /** The event occurrence this reminder belongs to: with event_id + offset it makes materialization idempotent. */
    eventOccurrenceAt: at(),
    /** Original moment before a snooze. */
    snoozedFrom: at(),
    lastFiredAt: at(),
    source: itemSourceEnum().notNull(),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("reminder_client_id_uq").on(t.clientId),
    index("reminder_due_idx").on(t.fireAt).where(sql`${t.status} = 'scheduled' AND ${t.deletedAt} IS NULL`),
    index("reminder_task_idx").on(t.taskId).where(sql`${t.taskId} IS NOT NULL`),
    uniqueIndex("reminder_event_offset_uq")
      .on(t.eventId, t.offsetMinutes, t.eventOccurrenceAt)
      .where(sql`${t.eventId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index("reminder_updated_idx").on(t.updatedAt),
    check("reminder_offset_needs_event", sql`(${t.offsetMinutes} IS NULL AND ${t.eventOccurrenceAt} IS NULL) OR ${t.eventId} IS NOT NULL`),
    check("reminder_offset_range", sql`${t.offsetMinutes} IS NULL OR ${t.offsetMinutes} BETWEEN 0 AND 40320`),
    check("reminder_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 500`),
    check("reminder_client_id_length", sql`${t.clientId} IS NULL OR char_length(${t.clientId}) BETWEEN 1 AND 100`),
  ],
);

/**
 * One delivered moment. `UNIQUE (reminder_id, occurrence_at)` makes a double send impossible, even if a second
 * worker appears by mistake. `action`/`action_at` make the notification's action token single use.
 */
export const reminderDelivery = pgTable(
  "reminder_delivery",
  {
    id: id(),
    reminderId: uuid()
      .notNull()
      .references(() => reminder.id, { onDelete: "cascade" }),
    /** The scheduled moment that fired (before any quiet-hours shift). */
    occurrenceAt: at().notNull(),
    sentAt: at(),
    late: boolean().notNull().default(false),
    devicesOk: smallint().notNull().default(0),
    devicesFailed: smallint().notNull().default(0),
    error: text(),
    action: text(),
    actionAt: at(),
  },
  (t) => [
    unique("reminder_delivery_occurrence_uq").on(t.reminderId, t.occurrenceAt),
    index("reminder_delivery_sent_idx").on(t.sentAt),
    check("reminder_delivery_action", sql`${t.action} IS NULL OR ${t.action} IN ('done', 'snooze')`),
    check("reminder_delivery_action_at", sql`(${t.action} IS NULL) = (${t.actionAt} IS NULL)`),
  ],
);

import { and, isNotNull, lt, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { auditEvent, authAttempt, event, habit, habitLog, notificationLog, reminder, sleepLog, task, taskList } from "../db/schema";
import { toDate } from "../domain/time";
import { purgeExpired } from "../http/idempotency";

/** Retention (docs/v2/05 + 07). */
export const RETENTION = { softDeletedDays: 30, authDays: 90, notificationDays: 180 } as const;

/**
 * Daily cleanup: soft-deleted rows past 30 days (tombstones offline clients no longer need), auth attempts and audit
 * events past 90 days, notification log past 180 days, expired idempotency keys. Idempotent.
 */
export async function prune(db: DbLike, now: Temporal.Instant) {
  const before = (days: number) => toDate(now.subtract({ hours: days * 24 }));
  const tombstone = before(RETENTION.softDeletedDays);
  const gone = async (p: Promise<unknown[]>) => (await p).length;
  const deadRows = <T extends { deletedAt: unknown }>(t: T & { deletedAt: Parameters<typeof lt>[0] }) =>
    and(isNotNull(t.deletedAt), lt(t.deletedAt, tombstone));

  const counts = {
    // reminders first (they may point at tasks/events), then tasks before their lists
    reminder: await gone(db.delete(reminder).where(deadRows(reminder)).returning({ id: reminder.id })),
    event: await gone(db.delete(event).where(deadRows(event)).returning({ id: event.id })),
    task: await gone(db.delete(task).where(deadRows(task)).returning({ id: task.id })),
    taskList: await gone(
      db
        .delete(taskList)
        .where(and(deadRows(taskList), sql`NOT EXISTS (SELECT 1 FROM task WHERE task.list_id = ${taskList.id})`))
        .returning({ id: taskList.id }),
    ),
    habitLog: await gone(db.delete(habitLog).where(deadRows(habitLog)).returning({ id: habitLog.id })),
    habit: await gone(db.delete(habit).where(deadRows(habit)).returning({ id: habit.id })), // remaining logs cascade
    sleepLog: await gone(db.delete(sleepLog).where(deadRows(sleepLog)).returning({ id: sleepLog.id })),
    authAttempt: await gone(
      db
        .delete(authAttempt)
        .where(lt(authAttempt.at, before(RETENTION.authDays)))
        .returning({ id: authAttempt.id }),
    ),
    auditEvent: await gone(
      db
        .delete(auditEvent)
        .where(lt(auditEvent.at, before(RETENTION.authDays)))
        .returning({ id: auditEvent.id }),
    ),
    notificationLog: await gone(
      db
        .delete(notificationLog)
        .where(lt(notificationLog.createdAt, before(RETENTION.notificationDays)))
        .returning({ id: notificationLog.id }),
    ),
    idempotencyKey: await purgeExpired(db, now),
  };
  return counts;
}

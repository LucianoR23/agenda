import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { apiToken, changeLog, dayReview, event, habit, habitLog, reminder, sleepLog, task, taskList } from "../db/schema";
import type { Ctx } from "../http/context";
import type { Entity, FieldDiff } from "./changes";
import { formatInstant } from "./time";

/**
 * The audit view (Ajustes → Auditoría): change_log read back as "what happened", newest first. change_log is never
 * pruned; each row carries the item's label at that moment, so deleted items stay readable after their row is
 * purged (30 days).
 */

/** What the item was called when it changed: its title, or a name built from its date. */
export async function labelOf(db: DbLike, entity: Entity, id: string): Promise<string | null> {
  const first = <T>(rows: T[]) => rows[0] ?? null;
  switch (entity) {
    case "task":
      return first(await db.select({ v: task.title }).from(task).where(eq(task.id, id)))?.v ?? null;
    case "task_list":
      return first(await db.select({ v: taskList.name }).from(taskList).where(eq(taskList.id, id)))?.v ?? null;
    case "reminder":
      return first(await db.select({ v: reminder.title }).from(reminder).where(eq(reminder.id, id)))?.v ?? null;
    case "event":
      return first(await db.select({ v: event.title }).from(event).where(eq(event.id, id)))?.v ?? null;
    case "habit":
      return first(await db.select({ v: habit.name }).from(habit).where(eq(habit.id, id)))?.v ?? null;
    case "habit_log": {
      const r = first(
        await db
          .select({ name: habit.name, date: habitLog.date })
          .from(habitLog)
          .innerJoin(habit, eq(habit.id, habitLog.habitId))
          .where(eq(habitLog.id, id)),
      );
      return r ? `${r.name} · ${r.date}` : null;
    }
    case "sleep_log": {
      const r = first(await db.select({ date: sleepLog.date }).from(sleepLog).where(eq(sleepLog.id, id)));
      return r ? `Sueño · ${r.date}` : null;
    }
    case "day_review": {
      const r = first(await db.select({ date: dayReview.date }).from(dayReview).where(eq(dayReview.date, id)));
      return `Cierre del día · ${r?.date ?? id}`;
    }
  }
}

export type AuditAction =
  | "created"
  | "edited"
  | "completed"
  | "cancelled"
  | "reopened"
  | "rescheduled"
  | "archived"
  | "restored"
  | "checked"
  | "unchecked"
  | "deleted";

/** The filter chips: a kind covers its related entities (habits with their daily checks). */
export const AUDIT_KINDS = {
  task: ["task", "task_list"],
  reminder: ["reminder"],
  event: ["event"],
  habit: ["habit", "habit_log"],
  sleep: ["sleep_log"],
  review: ["day_review"],
} as const satisfies Record<string, readonly Entity[]>;
export type AuditKind = keyof typeof AUDIT_KINDS;

/** A change_log row as something a person reads: "completaste", "cancelaste", "editaste (fecha, título)". */
export function auditAction(entity: string, action: "create" | "update" | "delete", fields: FieldDiff | undefined): AuditAction {
  if (entity === "habit_log") return action === "delete" ? "unchecked" : "checked";
  if (action === "create") return "created";
  if (action === "delete") return entity === "reminder" ? "cancelled" : "deleted";
  const status = fields?.status?.to;
  if (status === "done") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "open" || status === "scheduled") return "reopened";
  if (fields && "active" in fields) return fields.active?.to === false ? "archived" : "restored";
  const keys = Object.keys(fields ?? {});
  if (keys.length > 0 && keys.every((k) => ["fireAt", "dueDate", "dueTime", "startsAt", "endsAt", "snoozedFrom"].includes(k)))
    return "rescheduled";
  return "edited";
}

export async function listAudit(ctx: Ctx, q: { kind?: AuditKind; before?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const where = and(
    q.kind ? inArray(changeLog.entity, [...AUDIT_KINDS[q.kind]]) : undefined,
    q.before ? lt(changeLog.id, q.before) : undefined,
  );
  const rows = await ctx.db
    .select({ c: changeLog, tokenName: apiToken.name })
    .from(changeLog)
    .leftJoin(apiToken, eq(apiToken.id, changeLog.tokenId))
    .where(where)
    .orderBy(desc(changeLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    entries: page.map(({ c, tokenName }) => {
      const fields = c.diff?.fields;
      return {
        id: c.id,
        at: formatInstant(c.at, ctx.tz),
        entity: c.entity as Entity,
        entityId: c.entityId,
        action: auditAction(c.entity, c.action, fields),
        label: c.label,
        actor: c.actor,
        tokenName: tokenName ?? null,
        fields: Object.keys(fields ?? {}).filter((k) => !["seriesId", "completedAt", "snoozedFrom"].includes(k)),
      };
    }),
    next: rows.length > limit ? (page.at(-1)?.c.id ?? null) : null,
  };
}

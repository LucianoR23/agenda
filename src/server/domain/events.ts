import { and, eq, sql } from "drizzle-orm";
import { changeLog, webhookOutbox } from "../db/schema";
import { env } from "../env";
import { type Ctx, writer } from "../http/context";

export type Entity = "day" | "block" | "task" | "habit" | "habit_log" | "proposal" | "sleep_log" | "plan_option";
type Action = typeof changeLog.$inferInsert.action;
export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

export interface ChangeInput {
  entity: Entity;
  entityId: string | null;
  date: string | null;
  action: Action;
  fields?: FieldDiff;
  before?: unknown;
  after?: unknown;
  forced?: boolean;
  /** Extra context for the webhook (block title/type/start, task, habit, shift, sleep). */
  webhook?: Record<string, unknown>;
  /** Send the webhook batch now instead of after the debounce (choose, proposal accept/reject). */
  immediate?: boolean;
  /** Override the actor (lazy close inside a user's read is a `system` change). */
  actor?: "system";
}

const WEBHOOK_ENTITIES = new Set(["day", "block", "task", "habit_log", "proposal", "sleep_log"]);

/** Field-level diff of two objects (only keys present in `after`). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff {
  const out: FieldDiff = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

/**
 * Every write goes through here: one ChangeLog row and, for my (user) changes to day-scoped entities,
 * an entry in the per-day collecting webhook batch. Agent changes never reach the webhook (no loops).
 */
export async function recordChange(ctx: Ctx, c: ChangeInput) {
  await ctx.db.insert(changeLog).values({
    actor: c.actor ?? writer(ctx),
    entity: c.entity,
    entityId: c.entityId,
    date: c.date,
    action: c.action,
    diff: c.fields ? { fields: c.fields } : c.before !== undefined || c.after !== undefined ? { before: c.before, after: c.after } : null,
    forced: c.forced ?? false,
    requestId: ctx.requestId,
    at: ctx.now,
  });

  if ((c.actor ?? writer(ctx)) !== "user" || !c.date || !WEBHOOK_ENTITIES.has(c.entity) || !env().AGENT_WEBHOOK_URL) return;
  if (c.entity !== "proposal" && c.entity !== "day" && c.action === "update" && c.fields && !Object.keys(c.fields).length) return;

  const change = {
    entity: c.entity,
    id: c.entityId,
    action: c.action,
    ...(c.fields && Object.keys(c.fields).length ? { fields: c.fields } : {}),
    ...(c.webhook ?? {}),
    at: ctx.now.toISOString(),
  };
  const due = new Date(ctx.now.getTime() + (c.immediate ? 0 : env().WEBHOOK_DEBOUNCE_SECONDS * 1000));

  const updated = await ctx.db
    .update(webhookOutbox)
    .set({
      payload: sql`jsonb_set(${webhookOutbox.payload}, '{changes}', (${webhookOutbox.payload}->'changes') || ${JSON.stringify([change])}::jsonb)
        || ${c.immediate ? sql`'{"immediate": true}'::jsonb` : sql`'{}'::jsonb`}`,
      // debounce restarts on every change, unless an immediate change is already waiting
      nextAttemptAt: c.immediate
        ? due
        : sql`CASE WHEN ${webhookOutbox.payload} ? 'immediate' THEN ${webhookOutbox.nextAttemptAt} ELSE ${due.toISOString()}::timestamptz END`,
    })
    .where(and(eq(webhookOutbox.date, c.date), eq(webhookOutbox.status, "collecting")))
    .returning({ id: webhookOutbox.id });
  if (!updated.length) {
    await ctx.db
      .insert(webhookOutbox)
      .values({ date: c.date, payload: { changes: [change], ...(c.immediate ? { immediate: true } : {}) }, status: "collecting", nextAttemptAt: due });
  }
}

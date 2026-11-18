import { changeLog } from "../db/schema";
import { type Ctx, sourceOf, tokenIdOf } from "../http/context";
import { labelOf } from "./audit";
import { toDate } from "./time";

export type Entity = "task" | "task_list" | "reminder" | "event" | "habit" | "habit_log" | "sleep_log" | "day_review";
export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/** Fields that changed between two snapshots (shallow; arrays and dates compared by JSON). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff {
  const out: FieldDiff = {};
  for (const k of Object.keys(after)) {
    if (k === "version" || k === "updatedAt" || k === "updatedBy") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

/**
 * Appends to change_log (one row per write, inside the request transaction). The UUIDv7 id is the delta-sync cursor.
 * It also keeps the item's label at that moment (the audit view; change_log is never pruned).
 */
export async function recordChange(
  ctx: Ctx,
  entity: Entity,
  entityId: string,
  action: "create" | "update" | "delete",
  diff?: { before?: unknown; after?: unknown; fields?: FieldDiff },
) {
  await ctx.db.insert(changeLog).values({
    entity,
    entityId,
    action,
    actor: sourceOf(ctx.caller),
    tokenId: tokenIdOf(ctx.caller),
    diff: diff ?? null,
    label: await labelOf(ctx.db, entity, entityId),
    requestId: ctx.requestId,
    at: toDate(ctx.now),
  });
}

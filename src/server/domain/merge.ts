/**
 * Pure merge of an agent block list into an existing option (full-day PUT, proposal accept, `?mode=force`).
 *
 * Matching: calendar blocks by `externalId`, then any block by `id`, then agent blocks by type + title
 * (so re-sending the same day without ids is idempotent and never duplicates a block I tracked).
 * Matched block: schedule fields come from the agent unless the block is `locked` or the field is in
 * `userOverrides` (preserved). Tracking fields (status/outcome/note/remind) are never touched.
 * Unmatched existing blocks: my own blocks, locked blocks and blocks I tracked are kept (a tracked calendar block
 * gets `removedFromCalendarAt`); untouched agent/calendar blocks are deleted.
 */
import type { z } from "zod";
import type { BlockInput } from "@/contract/planning";
import type { BlockRow, NewBlock } from "./rows";

type In = z.infer<typeof BlockInput>;
export const SCHEDULE = ["start", "end", "title", "type", "callKind", "detail", "lead", "order"] as const;
export type ScheduleKey = (typeof SCHEDULE)[number];

export interface BlockRef {
  id: string | null;
  externalId: string | null;
  title: string;
  type: BlockRow["type"];
  start: string;
  end: string | null;
}

export interface MergePlan {
  inserts: Array<Omit<NewBlock, "optionId" | "dayId" | "updatedBy">>;
  updates: Array<{ before: BlockRow; set: Partial<BlockRow> }>;
  deletes: BlockRow[];
  diff: {
    added: BlockRef[];
    removed: BlockRef[];
    keptRemovedFromCalendar: BlockRef[];
    moved: Array<{ block: BlockRef; from: { start: string; end: string | null }; to: { start: string; end: string | null } }>;
    changed: Array<{ block: BlockRef; fields: Record<string, { from: unknown; to: unknown }> }>;
    preservedOverrides: Array<{ block: BlockRef; fields: ScheduleKey[] }>;
  };
}

export const isTracked = (b: Pick<BlockRow, "status" | "outcome" | "note">) => b.status !== "pending" || b.outcome !== null || b.note !== null;

export const ref = (b: Pick<BlockRow, "id" | "externalId" | "title" | "type" | "start" | "end">): BlockRef => ({
  id: b.id,
  externalId: b.externalId,
  title: b.title,
  type: b.type,
  start: b.start,
  end: b.end,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planMerge(existing: BlockRow[], input: In[], now: Date): MergePlan {
  const plan: MergePlan = {
    inserts: [],
    updates: [],
    deletes: [],
    diff: { added: [], removed: [], keptRemovedFromCalendar: [], moved: [], changed: [], preservedOverrides: [] },
  };
  const byExternal = new Map(existing.filter((b) => b.externalId).map((b) => [b.externalId!, b]));
  const byId = new Map(existing.map((b) => [b.id, b]));
  const matched = new Set<string>();

  input.forEach((inb, index) => {
    const target: Record<ScheduleKey, unknown> = {
      start: inb.start,
      end: inb.end ?? null,
      title: inb.title,
      type: inb.type,
      callKind: inb.type === "call" ? (inb.callKind ?? null) : null,
      detail: inb.detail ?? null,
      lead: inb.lead ?? null,
      order: inb.order ?? index,
    };
    const hit =
      (inb.externalId ? byExternal.get(inb.externalId) : undefined) ??
      (inb.id ? byId.get(inb.id) : undefined) ??
      // ids unknown to this day (e.g. from another environment) fall back to type + title too
      (inb.source === "agent" && !(inb.id && byId.has(inb.id))
        ? existing.find((b) => b.source === "agent" && !matched.has(b.id) && b.type === inb.type && b.title === inb.title)
        : undefined);

    if (!hit || matched.has(hit.id)) {
      plan.inserts.push({
        ...(inb.id && !byId.has(inb.id) ? { id: inb.id } : {}),
        start: inb.start,
        end: inb.end ?? null,
        title: inb.title,
        type: inb.type,
        callKind: inb.type === "call" ? (inb.callKind ?? null) : null,
        detail: inb.detail ?? null,
        lead: inb.lead ?? null,
        order: inb.order ?? index,
        source: inb.source,
        externalId: inb.externalId ?? null,
        externalUrl: inb.externalUrl ?? null,
        calendar: inb.calendar ?? null,
        remind: inb.type === "call",
      });
      plan.diff.added.push({ id: null, externalId: inb.externalId ?? null, title: inb.title, type: inb.type, start: inb.start, end: inb.end ?? null });
      return;
    }

    matched.add(hit.id);
    const set: Partial<BlockRow> = {};
    const preserved: ScheduleKey[] = [];
    for (const f of SCHEDULE) {
      const current = hit[f];
      if (same(current, target[f])) continue;
      if (hit.locked || hit.userOverrides.includes(f)) {
        preserved.push(f);
        continue;
      }
      (set as Record<string, unknown>)[f] = target[f];
    }
    if (hit.source === "calendar") {
      if (!same(hit.externalUrl, inb.externalUrl ?? null)) set.externalUrl = inb.externalUrl ?? null;
      if (!same(hit.calendar, inb.calendar ?? null)) set.calendar = inb.calendar ?? null;
      if (hit.removedFromCalendarAt) set.removedFromCalendarAt = null;
    }
    if (preserved.length) plan.diff.preservedOverrides.push({ block: ref(hit), fields: preserved });
    if (!Object.keys(set).length) return;

    plan.updates.push({ before: hit, set });
    if ("start" in set || "end" in set)
      plan.diff.moved.push({
        block: ref(hit),
        from: { start: hit.start, end: hit.end },
        to: { start: (set.start as string) ?? hit.start, end: "end" in set ? (set.end as string | null) : hit.end },
      });
    const other = Object.fromEntries(
      Object.entries(set)
        .filter(([k]) => !["start", "end", "order", "removedFromCalendarAt", "externalUrl"].includes(k))
        .map(([k, v]) => [k, { from: (hit as Record<string, unknown>)[k] ?? null, to: v }]),
    );
    if (Object.keys(other).length) plan.diff.changed.push({ block: ref(hit), fields: other });
  });

  for (const b of existing) {
    if (matched.has(b.id)) continue;
    if (b.source === "user" || b.locked) continue;
    if (isTracked(b)) {
      if (b.source === "calendar") {
        if (!b.removedFromCalendarAt) {
          plan.updates.push({ before: b, set: { removedFromCalendarAt: now } });
          plan.diff.keptRemovedFromCalendar.push(ref(b));
        }
      }
      continue;
    }
    plan.deletes.push(b);
    plan.diff.removed.push(ref(b));
  }
  return plan;
}

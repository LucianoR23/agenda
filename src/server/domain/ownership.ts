/**
 * Ownership rules for block edits (spec §6 "Ownership and conflict rules"). Pure: returns what to write or a violation.
 *
 * 1. Calendar blocks: schedule fields belong to Google (the agent mirrors them); I get `calendar_owned`.
 * 2. Agent/user blocks: every schedule field I edit joins `userOverrides`. The agent writing one of those, or anything
 *    on a `locked` block → `user_edit_conflict`, unless `force` (never on locked blocks; forced fields leave overrides).
 * 3. Tracking fields (status, outcome, note) are mine: the agent may set them only while unset / pending.
 *    `locked` and `remind` are mine only.
 */
import type { BlockRow } from "./rows";
import { SCHEDULE, type ScheduleKey } from "./merge";

export type BlockPatchInput = Partial<Pick<BlockRow, ScheduleKey | "status" | "outcome" | "note" | "locked" | "remind">> & {
  force?: boolean;
};

export type Violation =
  | { kind: "calendar_owned"; fields: string[] }
  | { kind: "user_edit_conflict"; fields: string[]; reason: "overrides" | "locked" | "tracking" }
  | { kind: "forbidden"; fields: string[] }
  | { kind: "invalid"; path: string; message: string };

export interface PatchPlan {
  set: Partial<BlockRow>;
  /** Schedule fields that changed (drives `edited` and the webhook). */
  scheduleChanged: ScheduleKey[];
  forced: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const TRACKING = ["status", "outcome", "note"] as const;

export function planBlockPatch(b: BlockRow, patch: BlockPatchInput, actor: "agent" | "user", now: Date): PatchPlan | Violation {
  const changed = (k: keyof BlockPatchInput) => k in patch && patch[k] !== undefined && !same(patch[k], b[k as keyof BlockRow]);
  const schedule = SCHEDULE.filter((f) => changed(f));
  const tracking = TRACKING.filter((f) => changed(f));
  const set: Partial<BlockRow> = {};
  let forced = false;

  const type = patch.type ?? b.type;
  if ((patch.outcome ?? b.outcome) && type !== "call" && changed("outcome")) return { kind: "invalid", path: "/outcome", message: "Only call blocks have an outcome" };
  if (patch.lead && type !== "call") return { kind: "invalid", path: "/lead", message: "Only call blocks have a lead" };
  if (patch.type && patch.type !== "call" && b.type === "call" && (b.lead || b.outcome) && patch.lead !== null)
    return { kind: "invalid", path: "/type", message: "Clear lead and outcome before changing a call's type" };

  if (actor === "user") {
    if (b.source === "calendar" && schedule.length) return { kind: "calendar_owned", fields: schedule };
    for (const f of schedule) (set as Record<string, unknown>)[f] = patch[f];
    if (schedule.length && b.source !== "calendar") set.userOverrides = [...new Set([...b.userOverrides, ...schedule])];
    if (changed("locked")) set.locked = patch.locked!;
    if (changed("remind")) set.remind = patch.remind!;
  } else {
    const mineOnly = (["locked", "remind"] as const).filter((f) => f in patch && patch[f] !== undefined);
    if (mineOnly.length) return { kind: "forbidden", fields: mineOnly };
    if (b.locked && (schedule.length || tracking.length)) return { kind: "user_edit_conflict", fields: [...schedule, ...tracking], reason: "locked" };
    const overridden = schedule.filter((f) => b.userOverrides.includes(f));
    if (overridden.length && !patch.force) return { kind: "user_edit_conflict", fields: overridden, reason: "overrides" };
    if (overridden.length) {
      forced = true;
      set.userOverrides = b.userOverrides.filter((f) => !overridden.includes(f));
    }
    for (const f of schedule) (set as Record<string, unknown>)[f] = patch[f];
    const mine = tracking.filter((f) => (f === "status" ? b.status !== "pending" : b[f] !== null));
    if (mine.length) return { kind: "user_edit_conflict", fields: mine, reason: "tracking" };
  }

  for (const f of tracking) (set as Record<string, unknown>)[f] = patch[f];
  if ("status" in set) set.statusAt = set.status === "pending" ? null : now;
  return { set, scheduleChanged: schedule, forced };
}

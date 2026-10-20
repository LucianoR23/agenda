import { and, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import type { BlockCreate, BlockExternalPatch, BlockPatch } from "@/contract/planning";
import { block, habit, habitLog } from "../db/schema";
import { type Ctx, writer } from "../http/context";
import { calendarOwned, forbidden, notFound, userEditConflict, validation, versionConflict } from "../http/errors";
import { dayForWrite, markEditedIfMine, touchDay } from "./days";
import { diffFields, recordChange } from "./events";
import { optionsOf, primaryOption } from "./load";
import { isTracked, SCHEDULE } from "./merge";
import { planBlockPatch, type BlockPatchInput, type Violation } from "./ownership";
import type { BlockRow, DayRow } from "./rows";
import { blockOut } from "./serialize";

const webhookBlock = (b: BlockRow) => ({
  block: { title: b.title, type: b.type, start: b.start, externalId: b.externalId, outcome: b.outcome, ...(b.type === "call" ? { callKind: b.callKind } : {}) },
});

function raise(v: Violation, b: BlockRow): never {
  const current = blockOut(b);
  switch (v.kind) {
    case "calendar_owned":
      throw calendarOwned(current);
    case "forbidden":
      throw forbidden(`User-only fields: ${v.fields.join(", ")}.`);
    case "invalid":
      throw validation([{ path: v.path, message: v.message }], 422);
    case "user_edit_conflict":
      throw userEditConflict(
        v.reason === "locked"
          ? "The block is locked by the user."
          : v.reason === "overrides"
            ? `Fields edited by the user: ${v.fields.join(", ")}. Send force: true to override.`
            : `${v.fields.join(", ")} ${v.fields.length > 1 ? "were" : "was"} set by the user.`,
        current,
      );
  }
}

async function getBlock(ctx: Ctx, d: DayRow, id: string) {
  const [b] = await ctx.db.select().from(block).where(and(eq(block.id, id), eq(block.dayId, d.id))).for("update");
  if (!b) throw notFound("Block");
  return b;
}

/**
 * Habit ↔ block link (D29): a block of a linked type going to `done` logs the habit for that date;
 * leaving `done` removes the log when no other done block of that type remains.
 */
async function syncLinkedHabit(ctx: Ctx, d: DayRow, b: BlockRow, from: BlockRow["status"], to: BlockRow["status"]) {
  if (from === to || (from !== "done" && to !== "done")) return;
  const [h] = await ctx.db.select().from(habit).where(and(eq(habit.blockType, b.type), eq(habit.active, true))).limit(1);
  if (!h) return;
  const by = writer(ctx);
  const source = by === "agent" ? "agent" : "user";
  if (to === "done") {
    const inserted = await ctx.db
      .insert(habitLog)
      .values({ habitId: h.id, date: d.date, done: true, source, updatedBy: by })
      .onConflictDoNothing()
      .returning();
    if (inserted[0])
      await recordChange(ctx, { entity: "habit_log", entityId: inserted[0].id, date: d.date, action: "create", fields: { done: { from: null, to: true } }, webhook: { habit: { slug: h.slug, name: h.name } } });
    return;
  }
  const others = await ctx.db
    .select({ id: block.id })
    .from(block)
    .where(and(eq(block.dayId, d.id), eq(block.optionId, b.optionId), eq(block.type, b.type), eq(block.status, "done"), ne(block.id, b.id)));
  if (others.length) return;
  const removed = await ctx.db.delete(habitLog).where(and(eq(habitLog.habitId, h.id), eq(habitLog.date, d.date), eq(habitLog.done, true))).returning();
  if (removed[0])
    await recordChange(ctx, { entity: "habit_log", entityId: removed[0].id, date: d.date, action: "delete", webhook: { habit: { slug: h.slug, name: h.name } } });
}

/** Applies a validated patch plan to one block; returns the updated row. */
async function applyPatch(ctx: Ctx, d: DayRow, b: BlockRow, patch: BlockPatchInput) {
  const actor = ctx.caller === "agent" ? "agent" : "user";
  const plan = planBlockPatch(b, patch, actor, ctx.now);
  if ("kind" in plan) raise(plan, b);
  if (!Object.keys(plan.set).length) return b;
  const [row] = await ctx.db.update(block).set({ ...plan.set, updatedBy: writer(ctx) }).where(eq(block.id, b.id)).returning();
  await touchDay(ctx, d.id, plan.scheduleChanged.length ? await markEditedIfMine(ctx, d) : {});
  const fields = diffFields(b as unknown as Record<string, unknown>, plan.set as Record<string, unknown>);
  delete fields.statusAt;
  delete fields.userOverrides;
  await recordChange(ctx, { entity: "block", entityId: b.id, date: d.date, action: "update", fields, forced: plan.forced, webhook: webhookBlock(row) });
  if (plan.set.status) await syncLinkedHabit(ctx, d, row, b.status, row.status);
  return row;
}

type PatchBody = z.infer<typeof BlockPatch>;

export async function patchBlock(ctx: Ctx, date: string, id: string, body: PatchBody) {
  const d = await dayForWrite(ctx, date);
  const b = await getBlock(ctx, d, id);
  const expected = body.version ?? ctx.ifMatch;
  if (expected !== null && expected !== undefined && expected !== b.version) throw versionConflict(expected, blockOut(b), b.version);
  const { version: _v, ...patch } = body;
  void _v;
  return applyPatch(ctx, d, b, patch as BlockPatchInput);
}

/** Agent mirror of a Google Calendar change, applied to every copy of the event (D28). */
export async function patchByExternal(ctx: Ctx, date: string, externalId: string, body: z.infer<typeof BlockExternalPatch>) {
  const d = await dayForWrite(ctx, date);
  const copies = await ctx.db.select().from(block).where(and(eq(block.dayId, d.id), eq(block.externalId, externalId))).for("update");
  if (!copies.length) throw notFound("Block");
  const { externalUrl, calendar, ...rest } = body;
  const out: BlockRow[] = [];
  for (const b of copies) {
    let row = await applyPatch(ctx, d, b, rest as BlockPatchInput);
    const meta: Partial<BlockRow> = {};
    if (externalUrl !== undefined && externalUrl !== row.externalUrl) meta.externalUrl = externalUrl;
    if (calendar !== undefined && calendar !== row.calendar) meta.calendar = calendar;
    if (Object.keys(meta).length) [row] = await ctx.db.update(block).set({ ...meta, updatedBy: writer(ctx) }).where(eq(block.id, b.id)).returning();
    out.push(row);
  }
  return out;
}

type CreateBody = z.infer<typeof BlockCreate>;

export async function createBlock(ctx: Ctx, date: string, optionLabel: string | undefined, body: CreateBody) {
  const d = await dayForWrite(ctx, date);
  const { options } = await optionsOf(ctx, d.id);
  const opt = optionLabel ? options.find((o) => o.label === optionLabel) : options.find((o) => o.id === d.chosenOptionId);
  if (!opt) throw optionLabel ? notFound(`Option ${optionLabel}`) : validation([{ path: "query/option", message: "Required while no option is chosen" }]);

  const actor = ctx.caller === "agent" ? "agent" : "user";
  const source = body.source ?? actor;
  if (source === "calendar" && actor !== "agent") throw forbidden("Only the agent mirrors calendar events.");
  if (source !== actor && source !== "calendar") throw forbidden(`source must be ${actor}.`);
  if (actor === "agent" && (body.locked !== undefined || body.remind !== undefined)) throw forbidden("locked and remind are mine.");

  const [row] = await ctx.db
    .insert(block)
    .values({
      ...(body.id ? { id: body.id } : {}),
      optionId: opt.id,
      dayId: d.id,
      start: body.start,
      end: body.end ?? null,
      title: body.title,
      type: body.type,
      callKind: body.type === "call" ? (body.callKind ?? null) : null,
      detail: body.detail ?? null,
      lead: body.lead ?? null,
      order: body.order ?? 0,
      source,
      externalId: body.externalId ?? null,
      externalUrl: body.externalUrl ?? null,
      calendar: body.calendar ?? null,
      locked: body.locked ?? false,
      remind: body.remind ?? body.type === "call",
      // my blocks: every schedule field is mine
      userOverrides: actor === "user" ? [...SCHEDULE] : [],
      updatedBy: writer(ctx),
    })
    .returning();
  await touchDay(ctx, d.id, opt.id === d.chosenOptionId ? await markEditedIfMine(ctx, d) : {});
  await recordChange(ctx, { entity: "block", entityId: row.id, date, action: "create", after: blockOut(row), webhook: webhookBlock(row) });
  return row;
}

export async function deleteBlock(ctx: Ctx, date: string, id: string) {
  const d = await dayForWrite(ctx, date);
  const b = await getBlock(ctx, d, id);
  if (ctx.ifMatch !== null && ctx.ifMatch !== b.version) throw versionConflict(ctx.ifMatch, blockOut(b), b.version);
  if (ctx.caller === "user" && b.source === "calendar") throw calendarOwned(blockOut(b), "Delete this event in Google Calendar.");
  if (ctx.caller === "agent" && (b.source === "user" || b.locked || isTracked(b) || b.userOverrides.length))
    throw userEditConflict("The user created, edited or tracked this block.", blockOut(b));
  await ctx.db.delete(block).where(eq(block.id, b.id));
  await touchDay(ctx, d.id, b.optionId === d.chosenOptionId ? await markEditedIfMine(ctx, d) : {});
  await recordChange(ctx, { entity: "block", entityId: b.id, date, action: "delete", before: blockOut(b), webhook: webhookBlock(b) });
}

export async function reorderBlocks(ctx: Ctx, date: string, ids: string[], bodyVersion?: number) {
  const d = await dayForWrite(ctx, date);
  const expected = bodyVersion ?? ctx.ifMatch;
  if (expected !== null && expected !== undefined && expected !== d.version) throw versionConflict(expected, { version: d.version }, d.version);
  if (new Set(ids).size !== ids.length) throw validation([{ path: "/ids", message: "Duplicate ids" }]);
  const rows = await ctx.db.select().from(block).where(and(eq(block.dayId, d.id), inArray(block.id, ids)));
  if (rows.length !== ids.length) throw notFound("Block");
  if (new Set(rows.map((r) => r.optionId)).size > 1) throw validation([{ path: "/ids", message: "Blocks must belong to one option" }]);
  const cal = rows.find((r) => r.source === "calendar");
  if (cal) throw calendarOwned(blockOut(cal));

  const out: BlockRow[] = [];
  for (const [i, id] of ids.entries()) {
    const b = rows.find((r) => r.id === id)!;
    const plan = planBlockPatch(b, { order: i }, ctx.caller === "agent" ? "agent" : "user", ctx.now);
    if ("kind" in plan) raise(plan, b);
    if (!Object.keys(plan.set).length) {
      out.push(b);
      continue;
    }
    const [row] = await ctx.db.update(block).set({ ...plan.set, updatedBy: writer(ctx) }).where(eq(block.id, b.id)).returning();
    out.push(row);
  }
  await touchDay(ctx, d.id, rows[0].optionId === d.chosenOptionId ? await markEditedIfMine(ctx, d) : {});
  await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "update", fields: { order: { from: null, to: ids } } });
  return out;
}

/** Sleep "bed" event marks that night's pending sleep block done. */
export async function markSleepBlockDone(ctx: Ctx, d: DayRow) {
  const { options, blocks } = await optionsOf(ctx, d.id);
  const opt = primaryOption(d, options);
  const s = blocks.find((b) => b.optionId === opt?.id && b.type === "sleep" && b.status === "pending");
  if (!s || d.status === "closed" && ctx.caller === "agent") return;
  await ctx.db.update(block).set({ status: "done", statusAt: ctx.now, updatedBy: writer(ctx) }).where(eq(block.id, s.id));
  await touchDay(ctx, d.id);
  await recordChange(ctx, { entity: "block", entityId: s.id, date: d.date, action: "update", fields: { status: { from: "pending", to: "done" } }, webhook: webhookBlock(s) });
}


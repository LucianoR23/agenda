import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import type { z } from "zod";
import type { DayInput, DayPatch } from "@/contract/planning";
import { getDb } from "../db/client";
import { block, day, planOption, proposal, task } from "../db/schema";
import { type Ctx, writer } from "../http/context";
import { ApiError, dayClosed, invalidTransition, notFound, userEditConflict, validation, versionConflict } from "../http/errors";
import { purgeExpired } from "../http/idempotency";
import { sendPush } from "../push";
import { fromMinutes, localDate, toMinutes } from "../time";
import { checkLinkable, idsForProposal, linkToProposal, resolveForProposals } from "./adjustments";
import { diffFields, recordChange } from "./events";
import { dayOut, findDay, isPast, optionsOf, primaryOption, proposalDiff, proposalOut, requireDay } from "./load";
import { planMerge } from "./merge";
import type { BlockRow, DayRow } from "./rows";

type DayInputT = z.infer<typeof DayInput>;

/** Bumps the day version (trigger) and optionally sets fields. */
export async function touchDay(ctx: Ctx, dayId: string, set: Partial<typeof day.$inferInsert> = {}): Promise<DayRow> {
  const [row] = await ctx.db.update(day).set({ ...set, updatedBy: writer(ctx) }).where(eq(day.id, dayId)).returning();
  return row;
}

export function checkVersion(ctx: Ctx, d: DayRow, bodyVersion: number | undefined, current: () => Promise<unknown>) {
  const expected = bodyVersion ?? ctx.ifMatch;
  if (expected !== null && expected !== undefined && expected !== d.version)
    return current().then((c) => {
      throw versionConflict(expected, c, d.version);
    });
  return Promise.resolve();
}

/** Closes a day (cron, lazy close or my PATCH). Pending proposals are superseded. */
export async function closeDay(ctx: Ctx, d: DayRow, actor: "system" | "user"): Promise<DayRow> {
  const [row] = await ctx.db
    .update(day)
    .set({ status: "closed", closedAt: ctx.now, updatedBy: actor })
    .where(eq(day.id, d.id))
    .returning();
  await supersedePending(ctx, d.id);
  await recordChange(ctx, {
    entity: "day",
    entityId: d.id,
    date: d.date,
    action: "close",
    fields: { status: { from: d.status, to: "closed" } },
    ...(actor === "system" ? { actor: "system" as const } : {}),
  });
  return row;
}

/** Supersedes the day's pending proposal; requests waiting on it are resolved. */
async function supersedePending(ctx: Ctx, dayId: string) {
  const gone = await ctx.db
    .update(proposal)
    .set({ status: "superseded", resolvedAt: ctx.now })
    .where(and(eq(proposal.dayId, dayId), eq(proposal.status, "pending")))
    .returning({ id: proposal.id });
  await resolveForProposals(ctx, gone.map((p) => p.id));
}

/** Lazy close: any access to a past day that is not closed closes it first. */
export async function ensureClosedIfPast(ctx: Ctx, d: DayRow): Promise<DayRow> {
  if (d.status !== "closed" && isPast(ctx, d.date)) return closeDay(ctx, d, "system");
  return d;
}

/** Loads a day for a write: locked, lazily closed, and closed-day protection for the agent. */
export async function dayForWrite(ctx: Ctx, date: string): Promise<DayRow> {
  const d = await ensureClosedIfPast(ctx, await requireDay(ctx, date, true));
  if (d.status === "closed" && ctx.caller === "agent") throw dayClosed(date);
  return d;
}

export async function getDay(ctx: Ctx, date: string) {
  const d = await ensureClosedIfPast(ctx, await requireDay(ctx, date, true));
  return dayOut(ctx, d);
}

// ---------- applying an agent body ----------

/** Day-level fields of an agent body (absent = unchanged). */
function dayFieldsOf(input: DayInputT): Partial<typeof day.$inferInsert> {
  const set: Partial<typeof day.$inferInsert> = {};
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.callsSummary !== undefined) set.callsSummary = input.callsSummary;
  if (input.weeklyGym !== undefined) {
    set.weeklyGymDone = input.weeklyGym?.done ?? null;
    set.weeklyGymTarget = input.weeklyGym?.target ?? null;
  }
  return set;
}

async function applyBlocks(ctx: Ctx, d: DayRow, input: DayInputT, mode: "replace" | "merge", bump = true) {
  const { options, blocks } = await optionsOf(ctx, d.id);
  const by = writer(ctx);
  const diffs: Record<string, ReturnType<typeof planMerge>["diff"]> = {};

  for (const [i, inOpt] of input.options.entries()) {
    let opt = options.find((o) => o.label === inOpt.label);
    if (!opt) {
      [opt] = await ctx.db
        .insert(planOption)
        .values({ dayId: d.id, label: inOpt.label, title: inOpt.title, description: inOpt.description ?? null, order: i, updatedBy: by })
        .returning();
    } else if (opt.title !== inOpt.title || opt.description !== (inOpt.description ?? null) || opt.order !== i) {
      await ctx.db
        .update(planOption)
        .set({ title: inOpt.title, description: inOpt.description ?? null, order: i, updatedBy: by })
        .where(eq(planOption.id, opt.id));
    }
    const plan = planMerge(
      blocks.filter((b) => b.optionId === opt!.id),
      inOpt.blocks,
      ctx.now,
    );
    if (plan.deletes.length) await ctx.db.delete(block).where(inArray(block.id, plan.deletes.map((b) => b.id)));
    for (const u of plan.updates) await ctx.db.update(block).set({ ...u.set, updatedBy: by }).where(eq(block.id, u.before.id));
    if (plan.inserts.length)
      await ctx.db.insert(block).values(plan.inserts.map((b) => ({ ...b, optionId: opt!.id, dayId: d.id, updatedBy: by })));
    diffs[inOpt.label] = plan.diff;
  }

  if (mode === "replace") {
    const keep = new Set(input.options.map((o) => o.label));
    const drop = options.filter((o) => !keep.has(o.label) && o.id !== d.chosenOptionId);
    if (drop.length) await ctx.db.delete(planOption).where(inArray(planOption.id, drop.map((o) => o.id)));
  }

  return { row: bump ? await touchDay(ctx, d.id, dayFieldsOf(input)) : d, diffs };
}

/** Syncs the agent's checklist for the date (Q6: applied immediately, even for proposals). */
async function syncAgentTasks(ctx: Ctx, d: DayRow, tasks: DayInputT["tasks"]) {
  if (!tasks) return;
  const by = writer(ctx);
  const { options, blocks } = await optionsOf(ctx, d.id);
  const target = primaryOption(d, options);
  const blockFor = (ext?: string) => (ext ? (blocks.find((b) => b.optionId === target?.id && b.externalId === ext)?.id ?? null) : null);

  const existing = await ctx.db.select().from(task).where(and(eq(task.date, d.date), eq(task.origin, "agent")));
  const used = new Set<string>();
  for (const [i, t] of tasks.entries()) {
    const kind = t.kind ?? "other";
    const hit = existing.find((e) => !used.has(e.id) && (t.id ? e.id === t.id : e.kind === kind && e.title === t.title));
    const values = { title: t.title, kind, order: t.order ?? i, relatedBlockId: blockFor(t.relatedExternalId) };
    if (hit) {
      used.add(hit.id);
      if (hit.title !== values.title || hit.kind !== values.kind || hit.order !== values.order || hit.relatedBlockId !== values.relatedBlockId)
        await ctx.db.update(task).set({ ...values, updatedBy: by }).where(eq(task.id, hit.id));
    } else {
      await ctx.db.insert(task).values({ ...(t.id ? { id: t.id } : {}), ...values, date: d.date, origin: "agent", updatedBy: by });
    }
  }
  const stale = existing.filter((e) => !used.has(e.id) && !e.done);
  if (stale.length) await ctx.db.delete(task).where(inArray(task.id, stale.map((e) => e.id)));
}

const summarize = (diffs: Record<string, ReturnType<typeof planMerge>["diff"]>) =>
  Object.fromEntries(
    Object.entries(diffs).map(([label, d]) => [
      label,
      { added: d.added.length, removed: d.removed.length, moved: d.moved.length, changed: d.changed.length, kept: d.keptRemovedFromCalendar.length, preserved: d.preservedOverrides.length },
    ]),
  );

// pushes run after commit, on the pool (the request transaction is gone by then)
const loadedPush = (ctx: Ctx, date: string, title: string, body: string) => {
  if (date < localDate(ctx.now)) return;
  ctx.afterCommit.push(() => sendPush(getDb(), { title, body, url: `/?date=${date}`, tag: `day-${date}` }));
};

export async function putDay(ctx: Ctx, date: string, input: DayInputT, force: boolean) {
  const existing = await findDay(ctx, date, true);

  if (!existing) {
    if (isPast(ctx, date)) throw dayClosed(date);
    await checkLinkable(ctx, date, input.adjustmentIds);
    // a new day starts at version 1: fields go into the insert, blocks don't bump it
    const [created] = await ctx.db.insert(day).values({ date, status: "draft", ...dayFieldsOf(input), updatedBy: writer(ctx) }).returning();
    const { row, diffs } = await applyBlocks(ctx, created, input, "replace", false);
    await syncAgentTasks(ctx, row, input.tasks);
    await recordChange(ctx, { entity: "day", entityId: row.id, date, action: "create", after: summarize(diffs) });
    loadedPush(ctx, date, "Agenbot cargó tu día", `${input.options.length} opciones para elegir.`);
    return { status: 201, result: "created" as const, day: row, proposal: null };
  }

  const d = await ensureClosedIfPast(ctx, existing);
  if (d.status === "closed") throw dayClosed(date);
  await checkVersion(ctx, d, undefined, async () => dayOut(ctx, d));
  // draft / force: applied directly, the requests stay pending until the agent closes them (D92)
  const adjustmentIds = await checkLinkable(ctx, date, input.adjustmentIds);

  if (d.status === "draft") {
    const { row, diffs } = await applyBlocks(ctx, d, input, "replace");
    await syncAgentTasks(ctx, row, input.tasks);
    await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "replace", after: summarize(diffs) });
    loadedPush(ctx, date, "Agenbot actualizó tu día", "Las opciones cambiaron.");
    return { status: 200, result: "replaced" as const, day: row, proposal: null };
  }

  const { options } = await optionsOf(ctx, d.id);
  const chosenLabel = options.find((o) => o.id === d.chosenOptionId)?.label;
  if (chosenLabel && !input.options.some((o) => o.label === chosenLabel))
    throw validation([{ path: "/options", message: `Must include the chosen option ${chosenLabel}` }], 422);

  if (force) {
    const { row, diffs } = await applyBlocks(ctx, d, input, "merge");
    await syncAgentTasks(ctx, row, input.tasks);
    await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "replace", after: summarize(diffs), forced: true });
    return { status: 200, result: "replaced" as const, day: row, proposal: null };
  }

  await supersedePending(ctx, d.id);
  const [p] = await ctx.db
    .insert(proposal)
    .values({ dayId: d.id, payload: input, reason: input.reason ?? null, baseDayVersion: d.version, createdAt: ctx.now })
    .returning();
  await linkToProposal(ctx, adjustmentIds, p.id);
  await syncAgentTasks(ctx, d, input.tasks);
  await recordChange(ctx, { entity: "proposal", entityId: p.id, date, action: "propose", after: { reason: p.reason, ...(adjustmentIds.length ? { adjustmentIds } : {}) } });
  const title = adjustmentIds.length ? "Tu ajuste está listo" : "Agenbot propone un cambio";
  ctx.afterCommit.push(() => sendPush(getDb(), { title, body: input.reason ?? "Revisá la propuesta para hoy.", url: `/?date=${date}&proposal=1`, tag: `proposal-${date}` }));
  return { status: 202, result: "proposed" as const, day: d, proposal: p };
}

export async function putDayResponse(ctx: Ctx, date: string, input: DayInputT, force: boolean) {
  const r = await putDay(ctx, date, input, force);
  const fresh = (await findDay(ctx, date))!;
  const out = await dayOut(ctx, fresh);
  const { options, blocks } = await optionsOf(ctx, fresh.id);
  return {
    status: r.status,
    body: { result: r.result, day: out, proposal: r.proposal ? proposalOut(r.proposal, fresh, options, blocks, ctx.now) : null },
    headers: r.status === 202 ? undefined : { ETag: `"${fresh.version}"` },
  };
}

// ---------- my own day ----------

export async function createOwnDay(ctx: Ctx, date: string, title?: string) {
  if (await findDay(ctx, date)) throw invalidTransition(`${date} already exists.`);
  const [d] = await ctx.db.insert(day).values({ date, status: "draft", updatedBy: "user" }).returning();
  const [opt] = await ctx.db.insert(planOption).values({ dayId: d.id, label: "A", title: title ?? "Mi día", order: 0, updatedBy: "user" }).returning();
  const [row] = await ctx.db.update(day).set({ status: "chosen", chosenOptionId: opt.id, updatedBy: "user" }).where(eq(day.id, d.id)).returning();
  await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "create", after: { own: true } });
  return row;
}

// ---------- patch ----------

type DayPatchT = z.infer<typeof DayPatch>;

export async function patchDay(ctx: Ctx, date: string, body: DayPatchT) {
  const d = await dayForWrite(ctx, date);
  await checkVersion(ctx, d, body.version, () => dayOut(ctx, d));
  const agent = ctx.caller === "agent";

  if (body.status === "closed") {
    if (agent) throw new ApiError(403, "forbidden", "Only I can close a day early.");
    if (d.status === "closed") return d;
  }
  if (agent && body.review !== undefined && d.reviewEnergy !== null)
    throw userEditConflict("The review was set by the user.", await dayOut(ctx, d));

  const set: Partial<typeof day.$inferInsert> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const put = (k: string, cur: unknown, next: unknown, apply: () => void) => {
    before[k] = cur;
    after[k] = next;
    apply();
  };
  if (body.notes !== undefined) put("notes", d.notes, body.notes, () => (set.notes = body.notes));
  if (body.callsSummary !== undefined) put("callsSummary", d.callsSummary, body.callsSummary, () => (set.callsSummary = body.callsSummary));
  if (body.weeklyGym !== undefined)
    put("weeklyGym", d.weeklyGymDone === null ? null : { done: d.weeklyGymDone, target: d.weeklyGymTarget }, body.weeklyGym, () => {
      set.weeklyGymDone = body.weeklyGym?.done ?? null;
      set.weeklyGymTarget = body.weeklyGym?.target ?? null;
    });
  if (body.review !== undefined)
    put("review", d.reviewEnergy === null ? null : { energy: d.reviewEnergy, mood: d.reviewMood, text: d.reviewText }, body.review, () => {
      set.reviewEnergy = body.review?.energy ?? null;
      set.reviewMood = body.review?.mood ?? null;
      set.reviewText = body.review?.text ?? null;
      set.reviewedAt = body.review ? ctx.now : null;
    });

  let row = Object.keys(set).length ? await touchDay(ctx, d.id, set) : d;
  const fields = diffFields(before, after);
  if (Object.keys(fields).length) await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "update", fields });
  if (body.status === "closed") row = await closeDay(ctx, row, "user");
  return row;
}

// ---------- choose ----------

export async function choose(ctx: Ctx, date: string, label: string, bodyVersion?: number) {
  const d = await dayForWrite(ctx, date);
  await checkVersion(ctx, d, bodyVersion, () => dayOut(ctx, d));
  if (d.status === "edited") throw invalidTransition("Cannot switch option on an edited day.");
  if (d.status === "closed") throw invalidTransition("The day is closed.");
  const { options } = await optionsOf(ctx, d.id);
  const opt = options.find((o) => o.label === label);
  if (!opt) throw notFound(`Option ${label}`);
  const prev = options.find((o) => o.id === d.chosenOptionId)?.label ?? null;
  const row = await touchDay(ctx, d.id, { status: "chosen", chosenOptionId: opt.id });
  await recordChange(ctx, {
    entity: "day",
    entityId: d.id,
    date,
    action: "choose",
    fields: { chosenOption: { from: prev, to: label }, status: { from: d.status, to: "chosen" } },
    immediate: true,
  });
  return row;
}

/** A chosen day becomes `edited` on my first schedule change. */
export async function markEditedIfMine(ctx: Ctx, d: DayRow): Promise<Partial<typeof day.$inferInsert>> {
  return ctx.caller === "user" && d.status === "chosen" ? { status: "edited" } : {};
}

// ---------- shift ("Me atrasé") ----------

export async function shift(ctx: Ctx, date: string, fromTime: string, minutes: number, bodyVersion?: number) {
  const d = await dayForWrite(ctx, date);
  await checkVersion(ctx, d, bodyVersion, () => dayOut(ctx, d));
  if (d.status === "draft") throw invalidTransition("Choose an option first.");
  const { blocks } = await optionsOf(ctx, d.id);
  const from = toMinutes(fromTime);
  const moving = blocks.filter(
    (b) => b.optionId === d.chosenOptionId && b.source !== "calendar" && b.status === "pending" && !b.locked && toMinutes(b.start) >= from,
  );
  const LIMIT = 29 * 60 + 59;
  const moved: Array<{ b: BlockRow; start: string; end: string | null }> = [];
  for (const b of moving) {
    const s = toMinutes(b.start) + minutes;
    const e = b.end === null ? null : toMinutes(b.end) + minutes;
    if (s < 0 || s > LIMIT || (e !== null && (e < 0 || e > LIMIT)))
      throw new ApiError(422, "shift_out_of_range", `"${b.title}" would start at ${fromMinutes(Math.max(0, s))}.`);
    moved.push({ b, start: fromMinutes(s), end: e === null ? null : fromMinutes(e) });
  }
  const by = writer(ctx);
  for (const m of moved) {
    const overrides = by === "user" ? [...new Set([...m.b.userOverrides, "start" as const, ...(m.b.end ? ["end" as const] : [])])] : m.b.userOverrides;
    await ctx.db.update(block).set({ start: m.start, end: m.end, userOverrides: overrides, updatedBy: by }).where(eq(block.id, m.b.id));
  }
  const row = await touchDay(ctx, d.id, await markEditedIfMine(ctx, d));
  const shiftInfo = { fromTime, minutes, blocks: moved.map((m) => ({ id: m.b.id, title: m.b.title, from: m.b.start, to: m.start })) };
  await recordChange(ctx, { entity: "day", entityId: d.id, date, action: "shift", after: shiftInfo, webhook: { shift: shiftInfo } });
  return row;
}

// ---------- proposals ----------

export async function listProposals(ctx: Ctx, date: string) {
  const d = await requireDay(ctx, date);
  const { options, blocks } = await optionsOf(ctx, d.id);
  const rows = await ctx.db.select().from(proposal).where(eq(proposal.dayId, d.id)).orderBy(asc(proposal.createdAt));
  return rows.reverse().map((p) => proposalOut(p, d, options, blocks, ctx.now));
}

async function pendingProposal(ctx: Ctx, d: DayRow, id: string) {
  const [p] = await ctx.db.select().from(proposal).where(and(eq(proposal.id, id), eq(proposal.dayId, d.id)));
  if (!p) throw notFound("Proposal");
  if (p.status !== "pending") throw invalidTransition(`Proposal is ${p.status}.`);
  return p;
}

export async function acceptProposal(ctx: Ctx, date: string, id: string) {
  const d = await ensureClosedIfPast(ctx, await requireDay(ctx, date, true));
  const p = await pendingProposal(ctx, d, id);
  await checkVersion(ctx, d, undefined, () => dayOut(ctx, d));
  const { options, blocks } = await optionsOf(ctx, d.id);
  const diff = proposalDiff(d, options, blocks, p.payload as DayInputT, ctx.now);
  await applyBlocks(ctx, d, p.payload as DayInputT, "merge");
  await ctx.db.update(proposal).set({ status: "accepted", resolvedAt: ctx.now }).where(eq(proposal.id, p.id));
  await resolveForProposals(ctx, [p.id]);
  const adjustmentIds = await idsForProposal(ctx, p.id);
  await recordChange(ctx, {
    entity: "proposal",
    entityId: p.id,
    date,
    action: "accept",
    after: { moved: diff.moved.length, added: diff.added.length, removed: diff.removed.length },
    ...(adjustmentIds.length ? { webhook: { adjustmentIds } } : {}),
    immediate: true,
  });
  return (await findDay(ctx, date))!;
}

export async function rejectProposal(ctx: Ctx, date: string, id: string) {
  const d = await requireDay(ctx, date, true);
  const p = await pendingProposal(ctx, d, id);
  const [row] = await ctx.db.update(proposal).set({ status: "rejected", resolvedAt: ctx.now }).where(eq(proposal.id, p.id)).returning();
  await resolveForProposals(ctx, [p.id]);
  const adjustmentIds = await idsForProposal(ctx, p.id);
  await recordChange(ctx, { entity: "proposal", entityId: p.id, date, action: "reject", ...(adjustmentIds.length ? { webhook: { adjustmentIds } } : {}), immediate: true });
  const { options, blocks } = await optionsOf(ctx, d.id);
  return proposalOut(row, d, options, blocks, ctx.now);
}

// ---------- close job ----------

export async function closePastDays(ctx: Ctx, only?: string) {
  const today = localDate(ctx.now);
  const rows = await ctx.db
    .select()
    .from(day)
    .where(and(ne(day.status, "closed"), only ? eq(day.date, only) : lt(day.date, today)))
    .orderBy(asc(day.date))
    .for("update");
  const closed: string[] = [];
  for (const d of rows) {
    if (d.date >= today) continue;
    await closeDay(ctx, d, "system");
    closed.push(d.date);
  }
  return { closed, purgedIdempotencyKeys: await purgeExpired(ctx.db, ctx.now) };
}


import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { AdjustmentPatch } from "@/contract/adjustments";
import { getDb } from "../db/client";
import { adjustment, day, proposal } from "../db/schema";
import { env } from "../env";
import { type Ctx, expectedVersion, writer } from "../http/context";
import { ApiError, dayClosed, notFound, versionConflict } from "../http/errors";
import { sendPush } from "../push";
import { isoLocal, isoLocalOrNull } from "../time";
import { enqueueEvent, recordChange } from "./events";
import { findDay, isPast } from "./load";
import type { AdjustmentRow, ProposalRow } from "./rows";

type Status = AdjustmentRow["status"];
const RESOLVED: Status[] = ["done", "failed", "cancelled"];

const adjustmentInvalid = (detail: string) => new ApiError(422, "adjustment_invalid", detail);
const adjustmentResolved = (row: AdjustmentRow, current: unknown, detail = `Adjustment is ${row.status}.`) =>
  new ApiError(409, "adjustment_resolved", detail, { current });

export function adjustmentOut(a: AdjustmentRow, p: Pick<ProposalRow, "id" | "status"> | null) {
  return {
    id: a.id,
    date: a.date,
    text: a.text,
    status: a.status,
    agentNote: a.agentNote,
    proposal: p ? { id: p.id, status: p.status } : null,
    resolvedAt: isoLocalOrNull(a.resolvedAt),
    version: a.version,
    createdAt: isoLocal(a.createdAt),
    updatedAt: isoLocal(a.updatedAt),
    updatedBy: a.updatedBy,
  };
}

async function select(ctx: Ctx, where: SQL | undefined, lock = false) {
  const q = ctx.db
    .select({ a: adjustment, p: { id: proposal.id, status: proposal.status } })
    .from(adjustment)
    .leftJoin(proposal, eq(proposal.id, adjustment.proposalId))
    .where(where)
    .orderBy(desc(adjustment.createdAt));
  return lock ? q.for("update", { of: adjustment }) : q;
}

async function load(ctx: Ctx, id: string, lock = false) {
  const [row] = await select(ctx, eq(adjustment.id, id), lock);
  if (!row) throw notFound("Adjustment");
  return row;
}

export async function listAdjustments(ctx: Ctx, q: { date?: string; status?: Status }) {
  const conds = [q.date ? eq(adjustment.date, q.date) : undefined, q.status ? eq(adjustment.status, q.status) : undefined].filter(Boolean) as SQL[];
  const rows = await select(ctx, conds.length ? and(...conds) : undefined);
  return rows.map((r) => adjustmentOut(r.a, r.p));
}

export async function getAdjustment(ctx: Ctx, id: string) {
  const r = await load(ctx, id);
  return adjustmentOut(r.a, r.p);
}

const links = (a: AdjustmentRow) => ({
  adjustmentUrl: `${env().APP_ORIGIN}/api/adjustments/${a.id}`,
  dayUrl: `${env().APP_ORIGIN}/api/days/${a.date}`,
});

/** I ask Agenbot to rearrange a day: `pending`, webhook right away. */
export async function createAdjustment(ctx: Ctx, input: { id?: string; date: string; text: string }) {
  if (isPast(ctx, input.date)) throw dayClosed(input.date);
  const d = await findDay(ctx, input.date);
  if (d?.status === "closed") throw dayClosed(input.date);
  const [row] = await ctx.db.insert(adjustment).values({ ...(input.id ? { id: input.id } : {}), date: input.date, text: input.text, updatedBy: writer(ctx), createdAt: ctx.now, updatedAt: ctx.now }).returning();
  await recordChange(ctx, { entity: "adjustment", entityId: row.id, date: row.date, action: "create", after: { text: row.text } });
  await enqueueEvent(ctx, row.date, { event: "adjustment.requested", adjustmentId: row.id, date: row.date, text: row.text, createdAt: isoLocal(row.createdAt), ...links(row) });
  return adjustmentOut(row, null);
}

/** Only while `pending`; tells Agenbot to stop (webhook right away). */
export async function cancelAdjustment(ctx: Ctx, id: string) {
  const { a, p } = await load(ctx, id, true);
  if (a.status !== "pending")
    throw adjustmentResolved(a, adjustmentOut(a, p), a.status === "proposed" ? "Adjustment is proposed; reject the proposal instead." : undefined);
  const [row] = await ctx.db.update(adjustment).set({ status: "cancelled", resolvedAt: ctx.now, updatedBy: writer(ctx) }).where(eq(adjustment.id, id)).returning();
  await recordChange(ctx, { entity: "adjustment", entityId: id, date: a.date, action: "update", fields: { status: { from: a.status, to: "cancelled" } } });
  await enqueueEvent(ctx, a.date, {
    event: "adjustment.cancelled",
    adjustmentId: a.id,
    date: a.date,
    text: a.text,
    createdAt: isoLocal(a.createdAt),
    cancelledAt: isoLocal(ctx.now),
    ...links(a),
  });
  return adjustmentOut(row, p);
}

/** The agent closes the request: `done` (+ note of what changed) or `failed` (+ reason). Never a webhook. */
export async function patchAdjustment(ctx: Ctx, id: string, body: z.infer<typeof AdjustmentPatch>) {
  const cur = await load(ctx, id, true);
  const { a } = cur;
  const expected = expectedVersion(ctx, body.version);
  if (expected !== null && expected !== undefined && expected !== a.version) throw versionConflict(expected, adjustmentOut(a, cur.p), a.version);
  if (RESOLVED.includes(a.status)) throw adjustmentResolved(a, adjustmentOut(a, cur.p));

  let p = cur.p;
  if (body.proposalId && body.proposalId !== a.proposalId) {
    const [hit] = await ctx.db
      .select({ id: proposal.id, status: proposal.status, date: day.date })
      .from(proposal)
      .innerJoin(day, eq(day.id, proposal.dayId))
      .where(eq(proposal.id, body.proposalId));
    if (!hit || hit.date !== a.date) throw adjustmentInvalid(`Proposal ${body.proposalId} is not a proposal for ${a.date}.`);
    p = { id: hit.id, status: hit.status };
  }
  // resolved now unless a proposal still waits for my decision
  const waiting = body.status === "done" && p?.status === "pending";
  const [row] = await ctx.db
    .update(adjustment)
    .set({
      status: body.status,
      agentNote: body.agentNote,
      proposalId: p?.id ?? null,
      resolvedAt: waiting ? null : (a.resolvedAt ?? ctx.now),
      updatedBy: writer(ctx),
    })
    .where(eq(adjustment.id, id))
    .returning();
  await recordChange(ctx, {
    entity: "adjustment",
    entityId: id,
    date: a.date,
    action: "update",
    fields: { status: { from: a.status, to: body.status }, agentNote: { from: a.agentNote, to: body.agentNote } },
  });
  if (body.status === "failed") push(ctx, a.date, "Agenbot no pudo ajustar", body.agentNote, `adjustment-${id}`);
  else if (!p) push(ctx, a.date, "Agenbot aplicó tu ajuste", body.agentNote, `adjustment-${id}`);
  return adjustmentOut(row, p);
}

const push = (ctx: Ctx, date: string, title: string, body: string, tag: string) =>
  ctx.afterCommit.push(() => sendPush(getDb(), { title, body, url: `/?date=${date}&adjustments=1`, tag }));

/** `PUT /api/days/{date}` with `adjustmentIds`: all must exist, be for this date and still `pending`. */
export async function checkLinkable(ctx: Ctx, date: string, ids: string[] | undefined) {
  if (!ids?.length) return [];
  const rows = await ctx.db.select().from(adjustment).where(inArray(adjustment.id, ids)).for("update");
  for (const id of ids) {
    const a = rows.find((r) => r.id === id);
    if (!a) throw adjustmentInvalid(`Adjustment ${id} not found.`);
    if (a.date !== date) throw adjustmentInvalid(`Adjustment ${id} is for ${a.date}, not ${date}.`);
    if (a.status !== "pending") throw adjustmentInvalid(`Adjustment ${id} is ${a.status}.`);
  }
  return ids;
}

/** The PUT became a proposal: the requests move to `proposed` and point to it. */
export async function linkToProposal(ctx: Ctx, ids: string[], proposalId: string) {
  if (!ids.length) return;
  await ctx.db.update(adjustment).set({ status: "proposed", proposalId, updatedBy: writer(ctx) }).where(inArray(adjustment.id, ids));
}

/** Proposals accepted, rejected or superseded: their requests have nothing left to wait for. */
export async function resolveForProposals(ctx: Ctx, proposalIds: string[]) {
  if (!proposalIds.length) return [];
  const rows = await ctx.db
    .update(adjustment)
    .set({ resolvedAt: ctx.now, updatedBy: writer(ctx) })
    .where(and(inArray(adjustment.proposalId, proposalIds), isNull(adjustment.resolvedAt)))
    .returning({ id: adjustment.id });
  return rows.map((r) => r.id);
}

/** Request ids answered by a proposal (for the accept/reject webhook change). */
export async function idsForProposal(ctx: Ctx, proposalId: string) {
  const rows = await ctx.db.select({ id: adjustment.id }).from(adjustment).where(eq(adjustment.proposalId, proposalId));
  return rows.map((r) => r.id);
}

import { and, asc, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Day, DayInput, Proposal } from "@/contract/planning";
import { block, day, habit, habitLog, planOption, proposal, sleepLog, task } from "../db/schema";
import type { Ctx } from "../http/context";
import { ApiError } from "../http/errors";
import { addDays, isoLocal, isoLocalOrNull, localDate } from "../time";
import { planMerge } from "./merge";
import type { BlockRow, DayRow, OptionRow, ProposalRow } from "./rows";
import { habitLogOut, optionOut, sleepOut, taskOut } from "./serialize";

type DayOut = z.infer<typeof Day>;
type ProposalOut = z.infer<typeof Proposal>;
type DayInputT = z.infer<typeof DayInput>;

export async function findDay(ctx: Ctx, date: string, lock = false): Promise<DayRow | null> {
  const q = ctx.db.select().from(day).where(eq(day.date, date)).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}

export async function requireDay(ctx: Ctx, date: string, lock = false): Promise<DayRow> {
  const row = await findDay(ctx, date, lock);
  if (!row) throw new ApiError(404, "day_not_found", `No plan for ${date} yet.`);
  return row;
}

export const isPast = (ctx: Ctx, date: string) => date < localDate(ctx.now);

export async function optionsOf(ctx: Ctx, dayId: string) {
  const options = await ctx.db.select().from(planOption).where(eq(planOption.dayId, dayId)).orderBy(asc(planOption.order), asc(planOption.label));
  const blocks = await ctx.db.select().from(block).where(eq(block.dayId, dayId));
  return { options, blocks };
}

/** Chosen option, or the first one (label order) when nothing was chosen. */
export function primaryOption(d: DayRow, options: OptionRow[]): OptionRow | null {
  return options.find((o) => o.id === d.chosenOptionId) ?? [...options].sort((a, b) => a.label.localeCompare(b.label))[0] ?? null;
}

/** Diff of a proposal payload against my chosen option (computed on read, so it is always current). */
export function proposalDiff(d: DayRow, options: OptionRow[], blocks: BlockRow[], payload: DayInputT, now: Date) {
  const target = primaryOption(d, options);
  const label = target?.label ?? payload.options[0].label;
  const inOpt = payload.options.find((o) => o.label === label) ?? payload.options[0];
  const plan = planMerge(target ? blocks.filter((b) => b.optionId === target.id) : [], inOpt.blocks, now);
  const dayFields: Record<string, { from: unknown; to: unknown }> = {};
  const cur: Record<string, unknown> = {
    notes: d.notes,
    callsSummary: d.callsSummary,
    weeklyGym: d.weeklyGymDone === null ? null : { done: d.weeklyGymDone, target: d.weeklyGymTarget },
  };
  for (const k of ["notes", "callsSummary", "weeklyGym"] as const) {
    if (payload[k] === undefined) continue;
    if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(payload[k] ?? null)) dayFields[k] = { from: cur[k] ?? null, to: payload[k] ?? null };
  }
  return { option: label, ...plan.diff, dayFields };
}

export function proposalOut(p: ProposalRow, d: DayRow, options: OptionRow[], blocks: BlockRow[], now: Date): ProposalOut {
  const payload = p.payload as DayInputT;
  return {
    id: p.id,
    date: d.date,
    status: p.status,
    reason: p.reason,
    baseDayVersion: p.baseDayVersion,
    createdAt: isoLocal(p.createdAt),
    resolvedAt: isoLocalOrNull(p.resolvedAt),
    diff: proposalDiff(d, options, blocks, payload, now),
    payload,
  };
}

/** Planned `sleep` block of a day (chosen option, or the first one). */
export async function plannedSleep(ctx: Ctx, date: string): Promise<{ start: string; end: string | null } | null> {
  const d = await findDay(ctx, date);
  if (!d) return null;
  const { options, blocks } = await optionsOf(ctx, d.id);
  const opt = primaryOption(d, options);
  const s = blocks.find((b) => b.optionId === opt?.id && b.type === "sleep");
  return s ? { start: s.start, end: s.end } : null;
}

export async function sleepFor(ctx: Ctx, date: string) {
  const [row] = await ctx.db.select().from(sleepLog).where(eq(sleepLog.date, date));
  return row ? sleepOut(row, await plannedSleep(ctx, date)) : null;
}

export async function dayOut(ctx: Ctx, d: DayRow): Promise<DayOut> {
  const { options, blocks } = await optionsOf(ctx, d.id);
  const tasks = await ctx.db.select().from(task).where(eq(task.date, d.date)).orderBy(asc(task.order), asc(task.createdAt));
  const logs = await ctx.db
    .select({ log: habitLog, slug: habit.slug })
    .from(habitLog)
    .innerJoin(habit, eq(habit.id, habitLog.habitId))
    .where(eq(habitLog.date, d.date));
  const [pending] = await ctx.db
    .select()
    .from(proposal)
    .where(and(eq(proposal.dayId, d.id), eq(proposal.status, "pending")))
    .orderBy(desc(proposal.createdAt))
    .limit(1);
  const chosen = options.find((o) => o.id === d.chosenOptionId);
  return {
    id: d.id,
    date: d.date,
    status: d.status,
    chosenOptionId: d.chosenOptionId,
    chosenOption: chosen?.label ?? null,
    notes: d.notes,
    callsSummary: d.callsSummary,
    weeklyGym: d.weeklyGymDone === null || d.weeklyGymTarget === null ? null : { done: d.weeklyGymDone, target: d.weeklyGymTarget },
    review: d.reviewEnergy === null || d.reviewMood === null ? null : { energy: d.reviewEnergy, mood: d.reviewMood, text: d.reviewText },
    reviewedAt: isoLocalOrNull(d.reviewedAt),
    closedAt: isoLocalOrNull(d.closedAt),
    options: options.map((o) => optionOut(o, blocks)),
    tasks: tasks.map(taskOut),
    habitLogs: logs.map((l) => habitLogOut(l.log, l.slug)),
    pendingProposal: pending ? proposalOut(pending, d, options, blocks, ctx.now) : null,
    sleep: { night: await sleepFor(ctx, d.date), previousNight: await sleepFor(ctx, addDays(d.date, -1)) },
    version: d.version,
    createdAt: isoLocal(d.createdAt),
    updatedAt: isoLocal(d.updatedAt),
    updatedBy: d.updatedBy,
  };
}


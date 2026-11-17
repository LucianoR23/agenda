import { eq } from "drizzle-orm";
import { one } from "../db/one";
import { dayReview } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, versionConflict } from "../http/errors";
import { recordChange } from "./changes";
import { userToday } from "./habits";
import { dropTask, getTask, inbox, updateTask } from "./tasks";
import { addDays, formatInstant, type IsoDate } from "./time";

type Row = typeof dayReview.$inferSelect;

export function reviewOut(r: Row, ctx: Pick<Ctx, "tz">) {
  return {
    date: r.date,
    mood: r.mood,
    note: r.note,
    highlights: r.highlights,
    movedTaskIds: r.movedTaskIds,
    version: r.version,
    createdAt: formatInstant(r.createdAt, ctx.tz),
    updatedAt: formatInstant(r.updatedAt, ctx.tz),
    updatedBy: r.updatedBy,
  };
}

export async function getReview(ctx: Ctx, date: IsoDate) {
  const [r] = await ctx.db.select().from(dayReview).where(eq(dayReview.date, date));
  return r ? reviewOut(r, ctx) : null;
}

export interface ReviewInput {
  mood?: number | null;
  note?: string | null;
  highlights?: string[];
  moves?: Array<{ taskId: string; to: "tomorrow" | "inbox" | "drop" }>;
  version?: number;
}

/**
 * "Cierre del día": mood, note, highlights, and the pending tasks sorted out (mañana / Inbox / soltar). Moves apply
 * once: a task that isn't open any more is skipped. Saving again edits the same review.
 */
export async function saveReview(ctx: Ctx, date: IsoDate, b: ReviewInput) {
  if (date > userToday(ctx))
    throw new ApiError(400, "VALIDATION_ERROR", "No se puede cerrar un día que todavía no llegó.", {
      fields: [{ path: "params/date", message: "Must not be in the future" }],
    });
  const [existing] = await ctx.db.select().from(dayReview).where(eq(dayReview.date, date)).for("update");
  if (existing && b.version != null && b.version !== existing.version) throw versionConflict(reviewOut(existing, ctx));

  const moved: string[] = [];
  for (const m of b.moves ?? []) {
    const t = await getTask(ctx, m.taskId);
    if (t.status !== "open") continue;
    if (m.to === "tomorrow") await updateTask(ctx, m.taskId, { dueDate: addDays(date, 1) });
    else if (m.to === "inbox") await updateTask(ctx, m.taskId, { dueDate: null, listId: (await inbox(ctx)).id });
    else await dropTask(ctx, m.taskId);
    moved.push(m.taskId);
  }

  const source = sourceOf(ctx.caller);
  const values = {
    ...(b.mood !== undefined ? { mood: b.mood } : {}),
    ...(b.note !== undefined ? { note: b.note?.trim() || null } : {}),
    ...(b.highlights !== undefined ? { highlights: b.highlights } : {}),
    movedTaskIds: [...new Set([...(existing?.movedTaskIds ?? []), ...moved])],
    updatedBy: source,
  };
  const row = existing
    ? one(await ctx.db.update(dayReview).set(values).where(eq(dayReview.date, date)).returning(), "review update")
    : one(
        await ctx.db
          .insert(dayReview)
          .values({ date, ...values })
          .returning(),
        "review insert",
      );
  await recordChange(ctx, "day_review", date, existing ? "update" : "create");
  return { status: existing ? 200 : 201, body: reviewOut(row, ctx) };
}

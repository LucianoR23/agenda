import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { one } from "../db/one";
import { sleepLog } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, notFound, versionConflict } from "../http/errors";
import { diffFields, recordChange } from "./changes";
import { addDays, dateOf, formatInstant, fromDate, type IsoDate, timeOf, toDate } from "./time";

type Row = typeof sleepLog.$inferSelect;

export function sleepOut(r: Row, ctx: Pick<Ctx, "tz">) {
  return {
    id: r.id,
    date: r.date,
    bedAt: r.bedAt ? formatInstant(r.bedAt, ctx.tz) : null,
    wakeAt: r.wakeAt ? formatInstant(r.wakeAt, ctx.tz) : null,
    durationMinutes: r.bedAt && r.wakeAt ? Math.round((r.wakeAt.getTime() - r.bedAt.getTime()) / 60_000) : null,
    quality: r.quality,
    notes: r.notes,
    source: r.source,
    version: r.version,
    createdAt: formatInstant(r.createdAt, ctx.tz),
    updatedAt: formatInstant(r.updatedAt, ctx.tz),
    updatedBy: r.updatedBy,
  };
}

export type SleepOut = ReturnType<typeof sleepOut>;

/**
 * The row a bedtime belongs to (rows are keyed by the wake-up date): from noon on it's tomorrow's night; after
 * midnight (before noon) it's today's.
 */
export const nightOfBed = (at: Temporal.Instant, tz: string): IsoDate =>
  timeOf(at, tz) >= "12:00" ? addDays(dateOf(at, tz), 1) : dateOf(at, tz);

export async function listSleep(ctx: Ctx, q: { from: IsoDate; to: IsoDate }) {
  const rows = await ctx.db
    .select()
    .from(sleepLog)
    .where(and(isNull(sleepLog.deletedAt), gte(sleepLog.date, q.from), lte(sleepLog.date, q.to)))
    .orderBy(asc(sleepLog.date));
  return rows.map((r) => sleepOut(r, ctx));
}

export async function sleepOn(ctx: Ctx, date: IsoDate) {
  const [r] = await ctx.db
    .select()
    .from(sleepLog)
    .where(and(eq(sleepLog.date, date), isNull(sleepLog.deletedAt)));
  return r ? sleepOut(r, ctx) : null;
}

interface Change {
  bedAt?: Temporal.Instant | null;
  wakeAt?: Temporal.Instant | null;
  quality?: number | null;
  notes?: string | null;
}

const bad = (path: string, message: string, text: string) => new ApiError(400, "VALIDATION_ERROR", text, { fields: [{ path, message }] });

async function writeSleep(ctx: Ctx, date: IsoDate, c: Change, expected?: number | null) {
  const [existing] = await ctx.db
    .select()
    .from(sleepLog)
    .where(and(eq(sleepLog.date, date), isNull(sleepLog.deletedAt)))
    .for("update");
  if (existing && expected != null && expected !== existing.version) throw versionConflict(sleepOut(existing, ctx));
  const bedAt = c.bedAt !== undefined ? c.bedAt : existing?.bedAt ? fromDate(existing.bedAt) : null;
  const wakeAt = c.wakeAt !== undefined ? c.wakeAt : existing?.wakeAt ? fromDate(existing.wakeAt) : null;
  const soon = ctx.now.add({ minutes: 1 });
  if (bedAt && Temporal.Instant.compare(bedAt, soon) > 0)
    throw bad("/bedAt", "Must not be in the future", "La hora de acostarte no puede ser futura.");
  if (wakeAt && Temporal.Instant.compare(wakeAt, soon) > 0)
    throw bad("/wakeAt", "Must not be in the future", "La hora de levantarte no puede ser futura.");
  if (bedAt && wakeAt) {
    if (Temporal.Instant.compare(wakeAt, bedAt) <= 0)
      throw bad("/wakeAt", "Must be after bedAt", "Te levantaste antes de acostarte: revisá las horas.");
    if (bedAt.until(wakeAt).total("hours") >= 20) throw bad("/wakeAt", "Under 20 hours", "Una noche no puede durar 20 horas o más.");
  }
  if (bedAt && nightOfBed(bedAt, ctx.tz) !== date && dateOf(bedAt, ctx.tz) !== date)
    throw bad("/bedAt", "Belongs to another night", `Esa hora de acostarte no corresponde a la noche que termina el ${date}.`);
  const source = sourceOf(ctx.caller);
  const values = {
    bedAt: bedAt ? toDate(bedAt) : null,
    wakeAt: wakeAt ? toDate(wakeAt) : null,
    ...(c.quality !== undefined ? { quality: c.quality } : {}),
    ...(c.notes !== undefined ? { notes: c.notes?.trim() || null } : {}),
  };
  if (existing) {
    const row = one(
      await ctx.db
        .update(sleepLog)
        .set({ ...values, updatedBy: source })
        .where(eq(sleepLog.id, existing.id))
        .returning(),
      "sleep update",
    );
    await recordChange(ctx, "sleep_log", row.id, "update", { fields: diffFields(existing, row) });
    return { status: 200, body: sleepOut(row, ctx) };
  }
  const row = one(
    await ctx.db
      .insert(sleepLog)
      .values({ date, ...values, source, updatedBy: source })
      .returning(),
    "sleep insert",
  );
  await recordChange(ctx, "sleep_log", row.id, "create");
  return { status: 201, body: sleepOut(row, ctx) };
}

/** "Me voy a dormir" / "Me levanté" (now, or back-dated). */
export function sleepEvent(ctx: Ctx, b: { type: "bed" | "wake"; at?: string }) {
  const at = b.at ? Temporal.Instant.from(b.at) : ctx.now;
  return b.type === "bed" ? writeSleep(ctx, nightOfBed(at, ctx.tz), { bedAt: at }) : writeSleep(ctx, dateOf(at, ctx.tz), { wakeAt: at });
}

export function upsertSleep(
  ctx: Ctx,
  date: IsoDate,
  b: { bedAt?: string | null; wakeAt?: string | null; quality?: number | null; notes?: string | null; version?: number },
) {
  const inst = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : Temporal.Instant.from(s));
  return writeSleep(
    ctx,
    date,
    {
      ...(b.bedAt !== undefined ? { bedAt: inst(b.bedAt) ?? null } : {}),
      ...(b.wakeAt !== undefined ? { wakeAt: inst(b.wakeAt) ?? null } : {}),
      ...(b.quality !== undefined ? { quality: b.quality } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
    },
    b.version ?? ctx.ifMatch,
  );
}

export async function deleteSleep(ctx: Ctx, date: IsoDate) {
  const [r] = await ctx.db
    .select()
    .from(sleepLog)
    .where(and(eq(sleepLog.date, date), isNull(sleepLog.deletedAt)));
  if (!r) throw notFound("No hay registro de sueño para esa fecha.");
  await ctx.db
    .update(sleepLog)
    .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(sleepLog.id, r.id));
  await recordChange(ctx, "sleep_log", r.id, "delete");
}

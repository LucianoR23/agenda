import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DbLike } from "./db/client";
import { getDb } from "./db/client";
import { block, day, notificationLog, planOption, sleepLog, webhookOutbox } from "./db/schema";
import { env } from "./env";
import { primaryOption } from "./domain/load";
import { sendPush } from "./push";
import { addDays, instantAt, isoLocal, localDate, localTime } from "./time";

export const MAX_WEBHOOK_ATTEMPTS = 5;
/** 30 s, 2 min, 8 min, 32 min between attempts. */
export const backoffMs = (attempt: number) => 30_000 * 4 ** (attempt - 1);

type Fetch = typeof fetch;

/** Builds the final payload for a batch (day version and summary at send time). */
async function buildPayload(db: DbLike, row: typeof webhookOutbox.$inferSelect): Promise<Record<string, unknown>> {
  // standalone events (adjustment.*) are stored ready to send
  if ("event" in (row.payload as object)) return row.payload as Record<string, unknown>;
  const [d] = await db.select().from(day).where(eq(day.date, row.date));
  let blocksDone = 0;
  let blocksTotal = 0;
  if (d) {
    const options = await db.select().from(planOption).where(eq(planOption.dayId, d.id));
    const opt = primaryOption(d, options);
    const blocks = opt ? await db.select().from(block).where(eq(block.optionId, opt.id)) : [];
    blocksTotal = blocks.length;
    blocksDone = blocks.filter((b) => b.status === "done").length;
  }
  const changes = ((row.payload as { changes: Array<Record<string, unknown>> }).changes ?? []).map((c) => ({ ...c, at: isoLocal(String(c.at)) }));
  return {
    event: "day.updated_by_user",
    batchId: row.id,
    date: row.date,
    dayVersion: d?.version ?? 0,
    changes,
    summary: {
      blocksDone,
      blocksTotal,
      weeklyGym: d && d.weeklyGymDone !== null && d.weeklyGymTarget !== null ? { done: d.weeklyGymDone, target: d.weeklyGymTarget } : null,
    },
    dayUrl: `${env().APP_ORIGIN}/api/days/${row.date}`,
  };
}

/** Delivers due batches (debounce elapsed or retry due). Never blocks user requests. */
export async function deliverDueWebhooks(now = new Date(), fetchImpl: Fetch = fetch) {
  const e = env();
  if (!e.AGENT_WEBHOOK_URL) return 0;
  const db = getDb();
  let delivered = 0;
  const due = await db
    .select()
    .from(webhookOutbox)
    .where(and(inArray(webhookOutbox.status, ["collecting", "pending"]), lte(webhookOutbox.nextAttemptAt, now)))
    .orderBy(asc(webhookOutbox.nextAttemptAt))
    .limit(20);
  for (const row of due) {
    // claim: collecting → pending so new changes start a new batch
    const [claimed] = await db
      .update(webhookOutbox)
      .set({ status: "pending", lastAttemptAt: now, attempts: sql`${webhookOutbox.attempts} + 1` })
      .where(and(eq(webhookOutbox.id, row.id), eq(webhookOutbox.attempts, row.attempts)))
      .returning();
    if (!claimed) continue;
    const payload = await buildPayload(db, claimed);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetchImpl(e.AGENT_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${e.AGENT_WEBHOOK_TOKEN ?? ""}`,
          "Idempotency-Key": claimed.id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = (err as Error).message;
    }
    if (!error) {
      await db.update(webhookOutbox).set({ status: "sent", sentAt: now, lastResponseStatus: status, lastError: null, payload }).where(eq(webhookOutbox.id, claimed.id));
      delivered++;
    } else {
      const failed = claimed.attempts >= MAX_WEBHOOK_ATTEMPTS;
      await db
        .update(webhookOutbox)
        .set({
          status: failed ? "failed" : "pending",
          lastResponseStatus: status,
          lastError: error,
          nextAttemptAt: new Date(now.getTime() + backoffMs(claimed.attempts)),
        })
        .where(eq(webhookOutbox.id, claimed.id));
    }
  }
  return delivered;
}

async function once(db: DbLike, key: string) {
  const r = await db.insert(notificationLog).values({ key }).onConflictDoNothing().returning();
  return r.length > 0;
}

/** 10-minute reminders for pending blocks with `remind` on (D61). */
export async function sendBlockReminders(now = new Date()) {
  const db = getDb();
  const date = localDate(now);
  let sent = 0;
  for (const dt of [addDays(date, -1), date]) {
    const [d] = await db.select().from(day).where(eq(day.date, dt));
    if (!d || d.status === "draft" || d.status === "closed" || !d.chosenOptionId) continue;
    const blocks = await db.select().from(block).where(and(eq(block.optionId, d.chosenOptionId), eq(block.remind, true), eq(block.status, "pending")));
    for (const b of blocks) {
      const at = instantAt(dt, b.start).getTime();
      const lead = at - now.getTime();
      if (lead > 10 * 60_000 || lead < 0) continue;
      if (!(await once(db, `remind:${b.id}:${b.start}`))) continue;
      await sendPush(
        db,
        {
          title: b.lead ? `${b.title} · ${b.lead.name}` : b.title,
          body: `Empieza a las ${localTime(new Date(at))}${b.type === "call" ? ". Tocá para llamar o escribir." : "."}`,
          url: `/?date=${dt}&block=${b.id}`,
          tag: `remind-${b.id}`,
        },
        "callReminders",
      );
      sent++;
    }
  }
  return sent;
}

/** Morning reminder when last night's sleep is incomplete (D57). */
export async function sendSleepReminder(now = new Date()) {
  const db = getDb();
  if (localTime(now) < env().SLEEP_REMINDER_TIME) return false;
  const night = addDays(localDate(now), -1);
  const [log] = await db.select().from(sleepLog).where(eq(sleepLog.date, night));
  if (log?.bedAt && log.wokeAt) return false;
  if (!(await once(db, `sleep:${night}`))) return false;
  await sendPush(
    db,
    { title: "¿Cómo dormiste?", body: "Cargá a qué hora te dormiste y te levantaste.", url: `/?sleep=${night}`, tag: `sleep-${night}` },
    "sleepReminders",
  );
  return true;
}

/** One worker tick (every 30 s from instrumentation). */
export async function tick(now = new Date()) {
  await deliverDueWebhooks(now).catch((e) => console.error("webhook delivery", e));
  await sendBlockReminders(now).catch((e) => console.error("block reminders", e));
  await sendSleepReminder(now).catch((e) => console.error("sleep reminder", e));
}


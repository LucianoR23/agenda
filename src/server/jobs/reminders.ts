import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { reminder, reminderDelivery } from "../db/schema";
import { effectiveDue } from "../domain/quiet-hours";
import { nextReminderFire } from "../domain/recurrence";
import { getSettings } from "../domain/settings";
import { fromDate, toDate } from "../domain/time";
import { log } from "../log";
import { actionToken, type PushPayload, sendPush } from "../push";

type Row = typeof reminder.$inferSelect;

/** Up to this late, a reminder is just "on time" (worker tick + clock skew); later it's sent as "Atrasado". */
const ON_TIME_MINUTES = 2;
const BATCH = 50;

export interface DispatchResult {
  sent: number;
  late: number;
  missed: number;
  deferred: number;
}

/** After an occurrence went out (or was missed): a one-off reminder settles, a recurring one moves to its next time. */
function settle(r: Row, now: Temporal.Instant, tz: string, outcome: "sent" | "missed") {
  const base = { snoozedFrom: null, updatedBy: "system" as const, ...(outcome === "sent" ? { lastFiredAt: toDate(now) } : {}) };
  if (!r.rrule) return { ...base, status: outcome };
  const next = nextReminderFire(r.rrule, fromDate(r.snoozedFrom ?? r.fireAt), tz, now);
  if (!next) return { ...base, status: outcome };
  return { ...base, fireAt: toDate(next.fireAt), rrule: next.rrule, status: "scheduled" as const };
}

/**
 * One worker pass (docs/v2/05). Due reminders are locked with SKIP LOCKED and each occurrence is claimed by inserting
 * its delivery row (UNIQUE reminder_id + occurrence_at), so nothing is ever pushed twice, even with a second worker.
 *
 * - Inside quiet hours (and not urgent): left alone until the window ends.
 * - Later than the user's `missedAfterHours`: marked missed, no push (the server was down).
 * - A few minutes late (e.g. after a restart): pushed as "Atrasado: …" with a 12 h TTL.
 */
export async function dispatchReminders(db: Db, now: Temporal.Instant): Promise<DispatchResult> {
  const settings = await getSettings(db);
  const tz = settings.timezone;
  const quiet = { start: settings.quietStart, end: settings.quietEnd };
  const result: DispatchResult = { sent: 0, late: 0, missed: 0, deferred: 0 };

  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(reminder)
      .where(and(eq(reminder.status, "scheduled"), isNull(reminder.deletedAt), lte(reminder.fireAt, toDate(now))))
      .orderBy(asc(reminder.fireAt))
      .limit(BATCH)
      .for("update", { skipLocked: true });

    for (const r of due) {
      const occurrence = fromDate(r.fireAt);
      const goesOutAt = effectiveDue(occurrence, tz, quiet, r.urgent);
      if (Temporal.Instant.compare(goesOutAt, now) > 0) {
        result.deferred++;
        continue;
      }
      const lateBy = goesOutAt.until(now).total("minutes");

      if (lateBy > settings.missedAfterHours * 60) {
        await tx
          .insert(reminderDelivery)
          .values({ reminderId: r.id, occurrenceAt: r.fireAt, late: true, error: "missed" })
          .onConflictDoNothing();
        await tx
          .update(reminder)
          .set(settle(r, now, tz, "missed"))
          .where(eq(reminder.id, r.id));
        result.missed++;
        continue;
      }

      const late = lateBy > ON_TIME_MINUTES;
      const [claimed] = await tx
        .insert(reminderDelivery)
        .values({ reminderId: r.id, occurrenceAt: r.fireAt, late })
        .onConflictDoNothing()
        .returning({ id: reminderDelivery.id });
      if (claimed) {
        const payload: PushPayload = {
          type: "reminder",
          id: r.id,
          title: late ? `Atrasado: ${r.title}` : r.title,
          body: r.body ?? "",
          url: "/recordatorios",
          tag: `reminder-${r.id}`,
          actions: [
            { action: "done", title: "Listo" },
            { action: "snooze", title: `Posponer ${settings.defaultSnoozeMinutes} min` },
          ],
          actionToken: actionToken(r.id, occurrence, now),
        };
        const sent = await sendPush(tx, payload, { ttl: late ? 12 * 3600 : 3600, urgency: r.urgent ? "high" : "normal" });
        await tx
          .update(reminderDelivery)
          .set({ sentAt: toDate(now), devicesOk: sent.ok, devicesFailed: sent.failed, error: sent.errors[0] ?? null })
          .where(eq(reminderDelivery.id, claimed.id));
        result.sent++;
        if (late) result.late++;
      }
      // claimed or not (someone else delivered it), this occurrence is done: move on
      await tx
        .update(reminder)
        .set(settle(r, now, tz, "sent"))
        .where(eq(reminder.id, r.id));
    }
  });
  if (result.sent || result.missed) log.info("reminders dispatched", { ...result });
  return result;
}

import { and, eq, isNull } from "drizzle-orm";
import { reminderDelivery } from "../db/schema";
import type { Ctx } from "../http/context";
import { ApiError } from "../http/errors";
import { hit } from "../http/ratelimit";
import { verifyActionToken } from "../push";
import { doneReminder, snoozeReminder } from "./reminders";
import { toDate } from "./time";

/** Taps per minute per IP on notification actions (the endpoint needs no session). */
export const PUSH_ACTION_LIMIT = 30;

/**
 * Listo / Posponer from a notification. The signed token names one reminder occurrence; claiming the delivery's
 * `action` column (only while it's still empty) makes each notification's action single use.
 */
export async function applyPushAction(ctx: Ctx, body: { token: string; action: "done" | "snooze" }) {
  const wait = hit(`push-action:${ctx.ip ?? "unknown"}`, PUSH_ACTION_LIMIT, ctx.now.epochMilliseconds);
  if (wait !== null)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Demasiados intentos; probá en un momento.",
      { retryAfterSeconds: wait },
      { "Retry-After": String(wait) },
    );

  const v = verifyActionToken(body.token, ctx.now);
  if (!v) throw new ApiError(401, "UNAUTHORIZED", "La notificación venció o no es válida. Abrí la app para hacerlo desde ahí.");

  const occurrenceAt = toDate(v.occurrence);
  const [claimed] = await ctx.db
    .update(reminderDelivery)
    .set({ action: body.action, actionAt: toDate(ctx.now) })
    .where(
      and(eq(reminderDelivery.reminderId, v.reminderId), eq(reminderDelivery.occurrenceAt, occurrenceAt), isNull(reminderDelivery.action)),
    )
    .returning({ id: reminderDelivery.id });
  if (!claimed) {
    const [exists] = await ctx.db
      .select({ id: reminderDelivery.id })
      .from(reminderDelivery)
      .where(and(eq(reminderDelivery.reminderId, v.reminderId), eq(reminderDelivery.occurrenceAt, occurrenceAt)));
    if (exists) throw new ApiError(409, "CONFLICT", "Esta notificación ya se usó.");
    throw new ApiError(404, "NOT_FOUND", "No encontré ese recordatorio.");
  }
  if (body.action === "done") await doneReminder(ctx, v.reminderId);
  else await snoozeReminder(ctx, v.reminderId, {});
  return { ok: true as const, action: body.action };
}

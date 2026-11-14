import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { sendNotification } from "web-push";
import { sign, unsign } from "./auth/crypto";
import type { DbLike } from "./db/client";
import { type ItemSource, notificationLog, pushSubscription } from "./db/schema";
import { env } from "./env";

/** What the service worker receives (see public/sw.js → push). */
export interface PushPayload {
  type: "reminder" | "notice" | "test";
  title: string;
  body: string;
  /** Path to open on tap. */
  url: string;
  tag?: string;
  /** Reminder id (type reminder). */
  id?: string;
  actions?: Array<{ action: "done" | "snooze"; title: string }>;
  /** Signed, single-use token the service worker sends back with an action (no session needed). */
  actionToken?: string;
}

export interface SendOptions {
  /** Seconds the push service keeps it for an offline device. */
  ttl?: number;
  urgency?: "normal" | "high";
}

type Sub = typeof pushSubscription.$inferSelect;
export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type PushSender = (sub: Sub, payload: PushPayload, opts: Required<SendOptions>) => Promise<SendResult>;

/** Consecutive failures after which a subscription is disabled (re-subscribing enables it again). */
export const MAX_FAILURES = 5;

const webPushSender: PushSender = async (sub, payload, opts) => {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return { ok: false, gone: false, error: "VAPID not configured" };
  try {
    await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      vapidDetails: { subject: e.VAPID_SUBJECT, publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
      TTL: opts.ttl,
      urgency: opts.urgency,
    });
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410, error: status ? `HTTP ${status}` : (err as Error).message };
  }
};

let sender: PushSender = webPushSender;

/** Tests: capture pushes instead of sending them. */
export const setPushSender = (s: PushSender | null) => {
  sender = s ?? webPushSender;
};

/**
 * Sends to every enabled subscription. 404/410 → the subscription is deleted. Other errors → failure_count + 1 and
 * the error kept; at MAX_FAILURES in a row it's disabled. Any success resets the count.
 */
export async function sendPush(db: DbLike, payload: PushPayload, opts: SendOptions = {}) {
  const options = { ttl: opts.ttl ?? 3600, urgency: opts.urgency ?? "normal" };
  const subs = await db.select().from(pushSubscription).where(isNull(pushSubscription.disabledAt));
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    const r = await sender(sub, payload, options);
    if (r.ok) {
      ok++;
      await db
        .update(pushSubscription)
        .set({ lastSuccessAt: new Date(), failureCount: 0, lastError: null })
        .where(eq(pushSubscription.id, sub.id));
      continue;
    }
    failed++;
    errors.push(r.error);
    if (r.gone) {
      await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      continue;
    }
    await db
      .update(pushSubscription)
      .set({
        failureCount: sql`${pushSubscription.failureCount} + 1`,
        lastError: r.error,
        disabledAt: sql`CASE WHEN ${pushSubscription.failureCount} + 1 >= ${MAX_FAILURES} THEN now() ELSE NULL END`,
      })
      .where(and(eq(pushSubscription.id, sub.id), isNull(pushSubscription.disabledAt)));
  }
  return { ok, failed, errors };
}

/** A non-reminder push (system notices, Sunday automations, tests), logged in notification_log. */
export async function sendNotice(
  db: DbLike,
  msg: { title: string; body: string; url: string; tag?: string },
  opts: { kind?: "notice" | "test"; source?: ItemSource; tokenId?: string | null } = {},
) {
  const kind = opts.kind ?? "notice";
  const r = await sendPush(db, { type: kind, ...msg });
  await db.insert(notificationLog).values({
    kind,
    title: msg.title,
    body: msg.body,
    url: msg.url,
    source: opts.source ?? "system",
    tokenId: opts.tokenId ?? null,
    devicesOk: r.ok,
    devicesFailed: r.failed,
  });
  return r;
}

// ---------- notification action tokens ----------

/** Days a notification's Listo / Posponer keeps working. */
export const ACTION_TOKEN_DAYS = 7;

/** A key used only for action tokens, derived from SESSION_SECRET (so it can't be used to forge anything else). */
const actionKey = () => createHmac("sha256", env().SESSION_SECRET).update("agenda/push-action/v1").digest("base64url");

/** HMAC-signed `reminderId|occurrence|exp`: lets the service worker act on a reminder without a session. */
export function actionToken(reminderId: string, occurrence: Temporal.Instant, now: Temporal.Instant): string {
  return sign(
    { r: reminderId, o: occurrence.epochMilliseconds, e: now.add({ hours: ACTION_TOKEN_DAYS * 24 }).epochMilliseconds },
    actionKey(),
  );
}

/** The reminder and occurrence a token stands for, or null if it's forged, malformed or expired. */
export function verifyActionToken(token: string, now: Temporal.Instant): { reminderId: string; occurrence: Temporal.Instant } | null {
  const p = unsign<{ r?: unknown; o?: unknown; e?: unknown }>(token, actionKey());
  if (!p || typeof p.r !== "string" || typeof p.o !== "number" || typeof p.e !== "number") return null;
  if (p.e < now.epochMilliseconds) return null;
  return { reminderId: p.r, occurrence: Temporal.Instant.fromEpochMilliseconds(p.o) };
}

import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { sendNotification } from "web-push";
import { sign, unsign } from "./auth/crypto";
import type { DbLike } from "./db/client";
import { type ItemSource, notificationLog, pushSubscription } from "./db/schema";
import { env } from "./env";
import { log } from "./log";

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
export type SendResult =
  | { ok: true }
  | {
      ok: false;
      gone: boolean;
      error: string;
      /** The push service's HTTP status, when it answered. */
      status?: number;
      /** The start of its response body (FCM, Mozilla and Apple explain the rejection there). */
      detail?: string;
    };
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
    const { statusCode: status, body } = err as { statusCode?: number; body?: unknown };
    return {
      ok: false,
      gone: status === 404 || status === 410,
      error: status ? `HTTP ${status}` : (err as Error).message,
      ...(status ? { status } : {}),
      ...(typeof body === "string" && body.trim() ? { detail: body.trim().slice(0, 200) } : {}),
    };
  }
};

/**
 * Why a push failed, from the push service's status (RFC 8030 / the services' docs):
 * - `expired` 404/410: the subscription is gone (uninstalled, permission revoked, expired). Deleting it is right.
 * - `vapid` 401/403: the push service rejected our VAPID signature: keys changed or don't match the subscription
 *   (subscribed with another VAPID_PUBLIC_KEY), or a bad VAPID_SUBJECT.
 * - `too_large` 413: the payload is over the service's limit (~4 KB).
 * - `rate_limited` 429, `push_service` 5xx: the service's side; retried with the next push.
 * - `network`: no answer at all (DNS, timeout); `not_configured`: VAPID_* missing on the server.
 */
export type PushFailureCause =
  | "expired"
  | "vapid"
  | "too_large"
  | "rate_limited"
  | "push_service"
  | "rejected"
  | "network"
  | "not_configured";

export function pushFailureCause(r: { status?: number; error: string }): PushFailureCause {
  const status = r.status ?? Number(/^HTTP (\d{3})/.exec(r.error)?.[1] ?? 0);
  if (status === 404 || status === 410) return "expired";
  if (status === 401 || status === 403) return "vapid";
  if (status === 413) return "too_large";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "push_service";
  if (status) return "rejected";
  return r.error === "VAPID not configured" ? "not_configured" : "network";
}

const HINT: Record<PushFailureCause, string> = {
  expired: "subscription expired or revoked: deleted",
  vapid: "VAPID rejected: check VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT (a key change needs every device to subscribe again)",
  too_large: "payload too large for the push service",
  rate_limited: "push service rate limit",
  push_service: "push service error",
  rejected: "push service rejected the request",
  network: "push service unreachable",
  not_configured: "VAPID keys not configured",
};

/** The push service's host (fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com…), never the
 * endpoint itself: its path is the subscription's capability URL. */
const serviceOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid endpoint";
  }
};

let sender: PushSender = webPushSender;

/** Tests: capture pushes instead of sending them. */
export const setPushSender = (s: PushSender | null) => {
  sender = s ?? webPushSender;
};

/**
 * Sends to every enabled subscription. 404/410 → the subscription is deleted. Other errors → failure_count + 1 and
 * the error kept; at MAX_FAILURES in a row it's disabled. Any success resets the count. Every failure is logged with
 * the status, its cause and what was done (never the endpoint or keys).
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
    const cause = pushFailureCause(r);
    const action = r.gone ? "deleted" : sub.failureCount + 1 >= MAX_FAILURES ? "disabled" : "kept";
    log.warn("push failed", {
      status: r.status ?? null,
      cause,
      hint: HINT[cause],
      action,
      failures: r.gone ? null : sub.failureCount + 1,
      pushService: serviceOf(sub.endpoint),
      subscription: sub.id,
      type: payload.type,
      bytes: Buffer.byteLength(JSON.stringify(payload)),
      ...(r.detail ? { detail: r.detail } : {}),
    });
    if (r.gone) {
      await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      continue;
    }
    await db
      .update(pushSubscription)
      .set({
        failureCount: sql`${pushSubscription.failureCount} + 1`,
        lastError: `${r.error} (${cause})`,
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
  opts: { kind?: "notice" | "test"; source?: ItemSource; tokenId?: string | null; at?: Temporal.Instant } = {},
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
    ...(opts.at ? { createdAt: new Date(opts.at.epochMilliseconds) } : {}),
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

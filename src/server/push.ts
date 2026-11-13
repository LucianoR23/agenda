import { eq, isNull, sql } from "drizzle-orm";
import { sendNotification } from "web-push";
import type { DbLike } from "./db/client";
import { type ItemSource, notificationLog, pushSubscription } from "./db/schema";
import { env } from "./env";

/**
 * Web Push sending. Phase 5 rebuilds delivery for reminders (actions, failure counting, disabling); this module
 * keeps the sender seam, the subscription cleanup and the notice log.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Path to open on tap. */
  url: string;
  tag?: string;
}

type Sub = typeof pushSubscription.$inferSelect;
export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type PushSender = (sub: Sub, msg: PushMessage) => Promise<SendResult>;

const webPushSender: PushSender = async (sub, msg) => {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return { ok: false, gone: false, error: "VAPID not configured" };
  try {
    await sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), {
      vapidDetails: { subject: e.VAPID_SUBJECT, publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
      TTL: 3600,
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

/** Sends to every enabled subscription. Gone endpoints (404/410) are removed; success is only recorded on success. */
export async function sendPush(db: DbLike, msg: PushMessage): Promise<{ ok: number; failed: number }> {
  const subs = await db.select().from(pushSubscription).where(isNull(pushSubscription.disabledAt));
  let ok = 0;
  let failed = 0;
  for (const sub of subs) {
    const r = await sender(sub, msg);
    if (r.ok) {
      ok++;
      await db
        .update(pushSubscription)
        .set({ lastSuccessAt: new Date(), failureCount: 0, lastError: null })
        .where(eq(pushSubscription.id, sub.id));
    } else {
      failed++;
      if (r.gone) await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
      else
        await db
          .update(pushSubscription)
          .set({ failureCount: sql`${pushSubscription.failureCount} + 1`, lastError: r.error })
          .where(eq(pushSubscription.id, sub.id));
    }
  }
  return { ok, failed };
}

/** A non-reminder push (system notices, Sunday automations, tests), logged in notification_log. */
export async function sendNotice(
  db: DbLike,
  msg: PushMessage,
  opts: { kind?: "notice" | "test"; source?: ItemSource; tokenId?: string | null } = {},
) {
  const r = await sendPush(db, msg);
  await db.insert(notificationLog).values({
    kind: opts.kind ?? "notice",
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

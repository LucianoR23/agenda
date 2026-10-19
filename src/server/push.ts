import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import type { DbLike } from "./db/client";
import { pushSubscription } from "./db/schema";
import { env } from "./env";

export interface PushMessage {
  title: string;
  body: string;
  /** Path to open on tap. */
  url: string;
  tag?: string;
}

type Sub = typeof pushSubscription.$inferSelect;
export type PushSender = (sub: Sub, msg: PushMessage) => Promise<{ gone: boolean }>;

const webPushSender: PushSender = async (sub, msg) => {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return { gone: false };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(msg),
      { vapidDetails: { subject: e.VAPID_SUBJECT, publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY }, TTL: 3600 },
    );
    return { gone: false };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return { gone: status === 404 || status === 410 };
  }
};

let sender: PushSender = webPushSender;

/** Tests: capture pushes instead of sending them. */
export const setPushSender = (s: PushSender | null) => {
  sender = s ?? webPushSender;
};

/** Sends to every subscription (optionally filtered by a per-device toggle). Expired subscriptions are removed. */
export async function sendPush(db: DbLike, msg: PushMessage, only?: "callReminders" | "sleepReminders") {
  const subs = await db.select().from(pushSubscription);
  for (const sub of subs) {
    if (only && !sub[only]) continue;
    const { gone } = await sender(sub, msg);
    if (gone) await db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
    else await db.update(pushSubscription).set({ lastSuccessAt: new Date(), failureCount: sql`0` }).where(eq(pushSubscription.id, sub.id));
  }
}

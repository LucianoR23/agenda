import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { webhookOutbox } from "@/server/db/schema";
import { backoffMs, deliverDueWebhooks, sendBlockReminders, sendSleepReminder } from "@/server/jobs";
import { WebhookPayload } from "@/contract/tracking";
import { agent, pushes, resetAll, setNow } from "../helpers/api";
import { blockOf, byExt, byTitle, byType, D, DATE, loadAndChoose, MARTIN } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

type Sent = { url: string; headers: Record<string, string>; body: { changes: Array<Record<string, unknown>>; [k: string]: unknown } };

function fakeFetch(statuses: number[] = []) {
  const sent: Sent[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, sent };
}

const at = (iso: string) => new Date(iso);

describe("webhook to Agenbot", () => {
  it("choose is sent immediately; my later changes are debounced 120 s into one batch", async () => {
    const { user, day } = await loadAndChoose(); // 07:42 choose
    const f = fakeFetch();
    expect(await deliverDueWebhooks(at("2026-10-19T07:42:05-03:00"), f.fn)).toBe(1);
    expect(f.sent[0].body.changes).toEqual([expect.objectContaining({ entity: "day", action: "choose" })]);
    expect(f.sent[0].headers).toMatchObject({ Authorization: "Bearer webhook-token", "Idempotency-Key": f.sent[0].body.batchId });
    expect(WebhookPayload.safeParse(f.sent[0].body).success).toBe(true);

    setNow("2026-10-19T10:48:00-03:00");
    await user.patch(`${D}/blocks/${blockOf(day, byExt(MARTIN)).id}`, { status: "done", outcome: "follow_up" });
    setNow("2026-10-19T10:49:30-03:00");
    await user.patch(`${D}/blocks/${blockOf(day, byTitle("Lectura (30 min)")).id}`, { start: "11:15", end: "11:45" });

    expect(await deliverDueWebhooks(at("2026-10-19T10:51:00-03:00"), f.fn)).toBe(0); // 90 s after the last change
    expect(await deliverDueWebhooks(at("2026-10-19T10:51:31-03:00"), f.fn)).toBe(1);
    const batch = f.sent[1].body;
    expect(WebhookPayload.safeParse(batch).success).toBe(true);
    expect(batch.changes.map((c) => c.action)).toEqual(["update", "update"]);
    expect(batch.changes[0]).toMatchObject({ entity: "block", fields: { status: { from: "pending", to: "done" }, outcome: { from: null, to: "follow_up" } } });
    expect(batch).toMatchObject({ date: DATE, dayVersion: 4, summary: { blocksDone: 1, blocksTotal: 12 }, dayUrl: `https://agenda.lemydev.com/api/days/${DATE}` });
  });

  it("the agent's own changes never trigger the webhook (no loops)", async () => {
    const { day } = await loadAndChoose();
    const f = fakeFetch();
    await deliverDueWebhooks(at("2026-10-19T07:43:00-03:00"), f.fn); // flush the choose
    await agent().patch(`${D}/blocks/${blockOf(day, byType("gym")).id}`, { status: "done" });
    await agent().patch(D, { callsSummary: "x" });
    expect(await deliverDueWebhooks(at("2026-10-19T09:00:00-03:00"), f.fn)).toBe(0);
    expect(await getDb().select().from(webhookOutbox)).toHaveLength(1);
  });

  it("retries with exponential backoff, 5 attempts, then failed; never blocks my request", async () => {
    await loadAndChoose();
    const f = fakeFetch([500, 502, 503, 500, 500]);
    let t = at("2026-10-19T07:42:05-03:00").getTime();
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await deliverDueWebhooks(new Date(t), f.fn)).toBe(0);
      const [row] = await getDb().select().from(webhookOutbox);
      expect(row.attempts).toBe(attempt);
      expect(row.status).toBe(attempt === 5 ? "failed" : "pending");
      expect(await deliverDueWebhooks(new Date(t + backoffMs(attempt) - 1000), f.fn)).toBe(0); // not due yet
      t += backoffMs(attempt);
    }
    expect(f.sent).toHaveLength(5);
    expect(new Set(f.sent.map((s) => s.body.batchId)).size).toBe(1); // same Idempotency-Key on every retry
    setNow("2026-10-19T09:00:00-03:00");
    const status = await agent().get("/api/webhook/status");
    expect(status.status).toBe(403);
  });

  it("webhook status in Ajustes", async () => {
    const { user } = await loadAndChoose();
    const f = fakeFetch();
    await deliverDueWebhooks(at("2026-10-19T07:42:05-03:00"), f.fn);
    const r = await user.get("/api/webhook/status");
    expect(r.body).toMatchObject({ configured: true, queued: 0, failedLast7Days: 0, lastDelivery: { status: "sent", attempts: 1, lastResponseStatus: 200 } });
  });
});

describe("reminders", () => {
  it("10 min before a pending call with remind on, once; respects the device toggle", async () => {
    const { user } = await loadAndChoose();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/a", keys: { p256dh: "k", auth: "a" } });
    expect(await sendBlockReminders(at("2026-10-19T09:49:00-03:00"))).toBe(0);
    expect(await sendBlockReminders(at("2026-10-19T09:51:00-03:00"))).toBe(1);
    expect(await sendBlockReminders(at("2026-10-19T09:52:00-03:00"))).toBe(0);
    expect(pushes.at(-1)).toMatchObject({ title: "Llamada de cierre · Martín Gómez" });

    await user.post("/api/push/subscribe", { endpoint: "https://push.test/a", keys: { p256dh: "k", auth: "a" }, callReminders: false });
    pushes.length = 0;
    await sendBlockReminders(at("2026-10-19T13:51:00-03:00"));
    expect(pushes).toHaveLength(0);
  });

  it("sleep reminder at 10:00 only when last night is incomplete, once", async () => {
    const { user } = await loadAndChoose();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/a", keys: { p256dh: "k", auth: "a" } });
    expect(await sendSleepReminder(at("2026-10-20T09:59:00-03:00"))).toBe(false);
    setNow("2026-10-20T07:05:00-03:00");
    await user.post("/api/sleep/events", { type: "wake" });
    expect(await sendSleepReminder(at("2026-10-20T10:00:00-03:00"))).toBe(true); // bed time missing
    expect(await sendSleepReminder(at("2026-10-20T10:01:00-03:00"))).toBe(false);
    expect(pushes.at(-1)?.title).toBe("¿Cómo dormiste?");
  });
});

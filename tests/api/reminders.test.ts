import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { pushSubscription, reminder, reminderDelivery } from "@/server/db/schema";
import { now } from "@/server/domain/time";
import { dispatchReminders } from "@/server/jobs/reminders";
import { actionToken, MAX_FAILURES } from "@/server/push";
import { anon, pushes, pushService, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll("2026-11-16T08:00:00-03:00")); // Monday 08:00
afterAll(() => closeDb());

const tick = () => dispatchReminders(getDb(), now());
const subscribe = (user: Awaited<ReturnType<typeof setupUser>>["user"], endpoint = "https://push.test/phone") =>
  user.post("/api/push/subscribe", { endpoint, keys: { p256dh: "k", auth: "a" } });

async function withReminder(body: Record<string, unknown>) {
  const { user } = await setupUser();
  await subscribe(user);
  const r = await user.post("/api/reminders", body);
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return { user, created: r.body };
}

describe("reminders API", () => {
  it("create, list upcoming, snooze, done, cancel", async () => {
    const { user, created } = await withReminder({ title: "Llamar al contador", fireAt: "2026-11-16T09:00:00-03:00" });
    expect(created).toMatchObject({ status: "scheduled", fireAt: "2026-11-16T09:00:00.000-03:00", source: "user" });
    expect((await user.get("/api/reminders?view=upcoming")).body.reminders).toHaveLength(1);
    const snoozed = await user.post(`/api/reminders/${created.id}/snooze`, {});
    expect(snoozed.body).toMatchObject({ fireAt: "2026-11-16T08:10:00.000-03:00", snoozedFrom: "2026-11-16T09:00:00.000-03:00" });
    expect((await user.post(`/api/reminders/${created.id}/done`, {})).body.status).toBe("done");
    expect((await user.del(`/api/reminders/${created.id}`)).status).toBe(204);
    expect((await user.get(`/api/reminders/${created.id}`)).status).toBe(404);
    expect((await user.post("/api/reminders", { title: "Antes", fireAt: "2026-11-16T07:00:00-03:00" })).status).toBe(400);
  });

  it("Listo completes the linked task; search finds reminders", async () => {
    const { user } = await setupUser();
    const t = (await user.post("/api/tasks", { title: "Pagar luz", dueDate: "2026-11-16" })).body;
    const r = (await user.post("/api/reminders", { title: "Pagar luz", fireAt: "2026-11-16T18:00:00-03:00", taskId: t.id })).body;
    await user.post(`/api/reminders/${r.id}/done`, {});
    expect((await user.get(`/api/tasks/${t.id}`)).body.status).toBe("done");
    const found = (await user.get("/api/search?q=luz&includeDone=true")).body.results.map((x: { type: string }) => x.type);
    expect(found).toEqual(["task", "reminder"]);
  });
});

describe("dispatcher", () => {
  it("exactly one push per occurrence, even if the worker runs again", async () => {
    await withReminder({ title: "Tomar la pastilla", fireAt: "2026-11-16T09:00:00-03:00" });
    setNow("2026-11-16T08:59:00-03:00");
    expect((await tick()).sent).toBe(0);
    setNow("2026-11-16T09:00:10-03:00");
    expect((await tick()).sent).toBe(1);
    expect((await tick()).sent).toBe(0); // second worker pass / restart
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ type: "reminder", title: "Tomar la pastilla", ttl: 3600, urgency: "normal" });
    expect(pushes[0]?.actions?.map((a) => a.action)).toEqual(["done", "snooze"]);
    const [row] = await getDb().select().from(reminder);
    expect(row?.status).toBe("sent");
  });

  it("a recurring reminder moves to its next time and fires again", async () => {
    await withReminder({ title: "Basura", fireAt: "2026-11-16T09:00:00-03:00", rrule: "FREQ=DAILY" });
    setNow("2026-11-16T09:00:05-03:00");
    await tick();
    const [r1] = await getDb().select().from(reminder);
    expect(r1?.status).toBe("scheduled");
    expect(r1?.fireAt.toISOString()).toBe("2026-11-17T12:00:00.000Z");
    setNow("2026-11-17T09:00:05-03:00");
    await tick();
    expect(pushes).toHaveLength(2);
    expect((await getDb().select().from(reminderDelivery)).length).toBe(2);
  });

  it("catch-up: a bit late → 'Atrasado' with a 12 h TTL; beyond the user's threshold → missed", async () => {
    const { user } = await withReminder({ title: "Turno", fireAt: "2026-11-16T09:00:00-03:00" });
    await user.post("/api/reminders", { title: "Viejo", fireAt: "2026-11-16T08:30:00-03:00" });
    setNow("2026-11-16T20:45:00-03:00"); // 11h45 and 12h15 late (server was down)
    const r = await tick();
    expect(r).toMatchObject({ sent: 1, late: 1, missed: 1 });
    expect(pushes[0]).toMatchObject({ title: "Atrasado: Turno", ttl: 12 * 3600 });
    const rows = await getDb().select().from(reminder);
    expect(rows.find((x) => x.title === "Viejo")?.status).toBe("missed");

    // the threshold is a setting
    await user.patch("/api/settings", { missedAfterHours: 24 });
    await user.post("/api/reminders", { title: "Otro", fireAt: "2026-11-16T20:50:00-03:00" });
    setNow("2026-11-17T18:00:00-03:00"); // 21 h late
    expect((await tick()).late).toBe(1);
  });

  it("quiet hours delay non-urgent reminders to their end without counting as late; urgent ones go out", async () => {
    const { user } = await withReminder({ title: "Leer", fireAt: "2026-11-16T23:45:00-03:00" });
    await user.post("/api/reminders", { title: "Remedio", fireAt: "2026-11-16T23:50:00-03:00", urgent: true });
    setNow("2026-11-16T23:51:00-03:00");
    const night = await tick();
    expect(night).toMatchObject({ sent: 1, deferred: 1 });
    expect(pushes[0]).toMatchObject({ title: "Remedio", urgency: "high" });
    setNow("2026-11-17T07:00:20-03:00");
    const morning = await tick();
    expect(morning).toMatchObject({ sent: 1, late: 0 });
    expect(pushes[1]?.title).toBe("Leer");
    const [delivery] = await getDb().select().from(reminderDelivery).where(eq(reminderDelivery.late, false));
    expect(delivery).toBeTruthy();
  });

  it("push failures: 410 removes the subscription; 5 failures disable it; a success resets the count", async () => {
    const { user } = await withReminder({ title: "A", fireAt: "2026-11-16T09:00:00-03:00" });
    await subscribe(user, "https://push.test/laptop");
    pushService.reply = (endpoint) =>
      endpoint.endsWith("phone") ? { ok: false, gone: true, error: "HTTP 410" } : { ok: false, gone: false, error: "HTTP 500" };
    for (let i = 0; i < MAX_FAILURES; i++) {
      await user.post("/api/reminders", { title: `R${i}`, fireAt: `2026-11-16T09:0${i + 1}:00-03:00` });
    }
    setNow("2026-11-16T09:10:00-03:00");
    await tick();
    const subs = await getDb().select().from(pushSubscription);
    expect(subs.map((s) => s.endpoint)).toEqual(["https://push.test/laptop"]);
    expect(subs[0]?.failureCount).toBe(MAX_FAILURES);
    expect(subs[0]?.disabledAt).not.toBeNull();
    // subscribing again re-enables it
    pushService.reply = () => ({ ok: true });
    await subscribe(user, "https://push.test/laptop");
    expect((await user.post("/api/push/test", {})).body).toEqual({ ok: 1, failed: 0 });
    const [again] = await getDb().select().from(pushSubscription);
    expect(again).toMatchObject({ failureCount: 0, disabledAt: null });
  });
});

describe("notification actions", () => {
  it("Listo from the notification: valid once, then a conflict; forged and expired tokens are rejected", async () => {
    await withReminder({ title: "Pastilla", fireAt: "2026-11-16T09:00:00-03:00" });
    setNow("2026-11-16T09:00:05-03:00");
    await tick();
    const token = pushes[0]?.actionToken as string;
    const sw = anon(); // the service worker has no session
    const done = await sw.post("/api/push/action", { token, action: "done" });
    expect(done.body).toEqual({ ok: true, action: "done" });
    expect((await getDb().select().from(reminder))[0]?.status).toBe("done");
    expect((await sw.post("/api/push/action", { token, action: "snooze" })).status).toBe(409);
    expect((await sw.post("/api/push/action", { token: `${token.slice(0, -2)}xx`, action: "done" })).status).toBe(401);
    setNow("2026-11-23T09:00:06-03:00"); // 7 days later
    expect((await sw.post("/api/push/action", { token, action: "done" })).status).toBe(401);
  });

  it("Posponer from the notification of a recurring reminder keeps the series on schedule", async () => {
    await withReminder({ title: "Agua", fireAt: "2026-11-16T09:00:00-03:00", rrule: "FREQ=DAILY" });
    setNow("2026-11-16T09:00:05-03:00");
    await tick();
    const r = await anon().post("/api/push/action", { token: pushes[0]?.actionToken, action: "snooze" });
    expect(r.status).toBe(200);
    setNow("2026-11-16T09:10:30-03:00");
    await tick();
    expect(pushes.map((p) => p.title)).toEqual(["Agua", "Agua"]);
    const [row] = await getDb().select().from(reminder);
    expect(row?.fireAt.toISOString()).toBe("2026-11-17T12:00:00.000Z"); // tomorrow 09:00, not 09:10
  });

  it("tokens for another occurrence don't match a delivery", async () => {
    const { created } = await withReminder({ title: "X", fireAt: "2026-11-16T09:00:00-03:00" });
    const wrong = actionToken(created.id, Temporal.Instant.from("2026-11-16T10:00:00-03:00"), now());
    expect((await anon().post("/api/push/action", { token: wrong, action: "done" })).status).toBe(404);
  });
});

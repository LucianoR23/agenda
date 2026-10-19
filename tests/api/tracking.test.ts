import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { agent, resetAll, setNow, setupUser } from "../helpers/api";
import { blockOf, byType, D, DATE, loadAndChoose } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

const gymHabit = { slug: "gym", name: "Gym", kind: "boolean", targetCount: 3, targetPeriod: "week", blockType: "gym" };
const readingHabit = { slug: "reading", name: "Lectura", kind: "numeric", unit: "páginas", targetCount: 20, targetPeriod: "day", blockType: "reading" };

describe("habits", () => {
  it("create, list with period progress; slug is unique; addressable by slug", async () => {
    const { user } = await setupUser();
    expect((await user.post("/api/habits", gymHabit)).status).toBe(201);
    expect((await user.post("/api/habits", gymHabit)).status).toBe(400);
    await user.post("/api/habits", readingHabit);
    const list = (await user.get("/api/habits")).body.habits;
    expect(list.map((h: { slug: string }) => h.slug)).toEqual(["gym", "reading"]);
    expect(list[0].period).toEqual({ start: "2026-10-19", end: "2026-10-25", count: 0, target: 3, met: false });
    const p = await user.patch("/api/habits/gym", { targetCount: 4 });
    expect(p.body.targetCount).toBe(4);
    expect((await user.patch("/api/habits/gym", { name: "x", version: 1 })).body.code).toBe("version_conflict");
  });

  it("marking the gym block done logs the habit (D29); undo removes it", async () => {
    const { user, day } = await loadAndChoose();
    await user.post("/api/habits", gymHabit);
    const gym = blockOf(day, byType("gym"));
    await user.patch(`${D}/blocks/${gym.id}`, { status: "done" });
    let h = (await user.get("/api/habits")).body.habits[0];
    expect(h.period.count).toBe(1);
    expect(h.today).toMatchObject({ done: true, source: "user" });
    await user.patch(`${D}/blocks/${gym.id}`, { status: "pending" });
    h = (await user.get("/api/habits")).body.habits[0];
    expect(h.period.count).toBe(0);
  });

  it("logs: upsert by date; the agent can't overwrite mine; numeric values", async () => {
    const { user } = await setupUser();
    await user.post("/api/habits", readingHabit);
    const c = await user.post("/api/habits/reading/logs", { date: DATE, done: true, value: 25 });
    expect(c.status).toBe(201);
    expect((await user.post("/api/habits/reading/logs", { date: DATE, done: true, value: 30 })).status).toBe(200);
    expect((await agent().post("/api/habits/reading/logs", { date: DATE, done: false })).body.code).toBe("user_edit_conflict");
    const logs = (await agent().get("/api/habits/reading/logs?from=2026-10-01&to=2026-10-31")).body.logs;
    expect(logs).toEqual([expect.objectContaining({ value: 30, habitSlug: "reading" })]);
    await user.post("/api/habits", { ...gymHabit, slug: "g2", blockType: null });
    expect((await user.post("/api/habits/g2/logs", { date: DATE, done: true, value: 2 })).status).toBe(422);
  });
});

describe("tasks", () => {
  it("agent checklist from the PUT; I tick one; the agent can't edit mine", async () => {
    const { user, day } = await loadAndChoose();
    const t = day.tasks as Array<{ id: string; title: string }>;
    const done = await user.patch(`/api/tasks/${t[0].id}`, { done: true });
    expect(done.body).toMatchObject({ done: true, doneAt: "2026-10-19T07:42:00.000-03:00" });
    expect((await agent().patch(`/api/tasks/${t[0].id}`, { done: false })).body.code).toBe("user_edit_conflict");

    const mine = await user.post("/api/tasks", { date: DATE, title: "Mandar audio a Martín", kind: "follow_up" });
    expect(mine.body.origin).toBe("user");
    expect((await agent().patch(`/api/tasks/${mine.body.id}`, { title: "otro" })).body.code).toBe("user_edit_conflict");
    expect((await agent().patch(`/api/tasks/${mine.body.id}`, { done: true })).status).toBe(200);
    expect((await agent().del(`/api/tasks/${mine.body.id}`)).body.code).toBe("user_edit_conflict");
    expect((await agent().get(`/api/tasks?date=${DATE}&done=false`)).body.tasks).toHaveLength(3);
    expect((await user.del(`/api/tasks/${mine.body.id}`)).status).toBe(204);
  });
});

describe("sleep", () => {
  it("Me voy a dormir at 00:20 belongs to the previous night and marks the sleep block done", async () => {
    const { user } = await loadAndChoose();
    setNow("2026-10-20T00:20:00-03:00");
    const bed = await user.post("/api/sleep/events", { type: "bed" });
    expect(bed.status).toBe(201);
    expect(bed.body).toMatchObject({ date: DATE, bedAt: "2026-10-20T00:20:00.000-03:00", plannedStart: "23:30", bedDelayMinutes: 50 });
    setNow("2026-10-20T07:05:00-03:00");
    const wake = await user.post("/api/sleep/events", { type: "wake" });
    expect(wake.body).toMatchObject({ wokeAt: "2026-10-20T07:05:00.000-03:00", durationMinutes: 405 });
    const day = (await user.get(D)).body;
    expect(blockOf(day, byType("sleep")).status).toBe("done");
    expect(day.sleep.night.durationMinutes).toBe(405);
  });

  it("manual load; validation; the agent fills only empty halves", async () => {
    const { user } = await setupUser();
    setNow("2026-10-20T10:00:00-03:00");
    expect((await user.put("/api/sleep/2026-10-19", { bedAt: "2026-10-20T07:00:00-03:00", wokeAt: "2026-10-19T23:50:00-03:00" })).status).toBe(400);
    expect((await user.put("/api/sleep/2026-10-19", { bedAt: "2026-10-20T11:00:00-03:00" })).status).toBe(422); // future
    const r = await agent().post("/api/sleep/events", { type: "bed", at: "2026-10-20T00:10:00-03:00" });
    expect(r.body.bedSource).toBe("agent");
    const mine = await user.put("/api/sleep/2026-10-19", { bedAt: "2026-10-20T00:20:00-03:00", wokeAt: "2026-10-20T07:00:00-03:00" });
    expect(mine.status).toBe(200);
    expect((await agent().post("/api/sleep/events", { type: "wake", at: "2026-10-20T07:30:00-03:00" })).body.code).toBe("user_edit_conflict");
    expect((await user.get("/api/sleep?from=2026-10-19&to=2026-10-19")).body.logs[0].durationMinutes).toBe(400);
  });
});

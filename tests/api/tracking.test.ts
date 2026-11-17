import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { client, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll("2026-11-18T21:00:00-03:00")); // Wednesday 21:00
afterAll(() => closeDb());

type User = Awaited<ReturnType<typeof setupUser>>["user"];
const habitsOf = async (user: User, date?: string) =>
  (await user.get(`/api/habits${date ? `?date=${date}` : ""}`)).body.habits as Array<{
    slug: string;
    streak: { current: number; best: number };
    period: { count: number; met: boolean };
    log: { done: boolean; value: number | null; source: string } | null;
  }>;

describe("habits", () => {
  it("create (slug from the name), check by slug, weekly progress and streaks", async () => {
    const { user } = await setupUser();
    const created = await user.post("/api/habits", { name: "Gym", targetCount: 3, targetPeriod: "week" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      slug: "gym",
      kind: "boolean",
      period: { start: "2026-11-16", end: "2026-11-22", count: 0, target: 3 },
    });
    expect((await user.post("/api/habits", { name: "Gym" })).status).toBe(409);

    // last week: three days → met; this week: two so far
    for (const date of ["2026-11-09", "2026-11-11", "2026-11-13", "2026-11-16", "2026-11-18"]) {
      expect((await user.post("/api/habits/gym/log", { date })).status).toBe(200);
    }
    let [gym] = await habitsOf(user);
    expect(gym).toMatchObject({ streak: { current: 1, best: 1 }, period: { count: 2, met: false }, log: { done: true } });

    // uncheck today
    await user.post("/api/habits/gym/log", { done: false });
    [gym] = await habitsOf(user);
    expect(gym?.period.count).toBe(1);
    expect(gym?.log).toBeNull();
    expect((await user.post("/api/habits/gym/log", { date: "2026-11-19" })).status).toBe(400);
  });

  it("numeric habits sum values; a daily streak counts consecutive days", async () => {
    const { user } = await setupUser();
    await user.post("/api/habits", { name: "Lectura", kind: "numeric", unit: "páginas", targetCount: 20 });
    expect((await user.post("/api/habits/lectura/log", {})).status).toBe(400); // needs a value
    await user.post("/api/habits/lectura/log", { date: "2026-11-16", value: 25 });
    await user.post("/api/habits/lectura/log", { date: "2026-11-17", value: 20 });
    const r = await user.post("/api/habits/lectura/log", { value: 10 });
    expect(r.body).toMatchObject({ period: { count: 10, met: false }, streak: { current: 2 } });
    await user.post("/api/habits/lectura/log", { value: 30 });
    expect((await habitsOf(user))[0]).toMatchObject({ period: { count: 30, met: true }, streak: { current: 3, best: 3 } });
    const logs = (await user.get("/api/habits/lectura/logs?from=2026-11-16&to=2026-11-18")).body.logs;
    expect(logs.map((l: { value: number }) => l.value)).toEqual([25, 20, 30]);
  });

  it("a task with the habit's tag checks it; undoing the task unchecks it (unless another one is done)", async () => {
    const { user } = await setupUser();
    await user.post("/api/habits", { name: "Gym", targetCount: 3, targetPeriod: "week", taskTag: "Gym" });
    expect((await user.post("/api/habits", { name: "Lectura", kind: "numeric", targetCount: 20, taskTag: "leer" })).status).toBe(400);
    const a = (await user.post("/api/tasks", { title: "Pecho y espalda", dueDate: "2026-11-18", tags: ["gym"] })).body;
    const b = (await user.post("/api/tasks", { title: "Cardio", dueDate: "2026-11-18", tags: ["GYM"] })).body;
    await user.post(`/api/tasks/${a.id}/complete`, {});
    expect((await habitsOf(user))[0]?.log).toMatchObject({ done: true, source: "system" });
    await user.post(`/api/tasks/${b.id}/complete`, {});
    await user.post(`/api/tasks/${a.id}/reopen`, {});
    expect((await habitsOf(user))[0]?.log).not.toBeNull(); // Cardio is still done
    await user.post(`/api/tasks/${b.id}/reopen`, {});
    expect((await habitsOf(user))[0]?.log).toBeNull();

    // checked by hand: a task's undo never removes it
    await user.post("/api/habits/gym/log", {});
    await user.post(`/api/tasks/${a.id}/complete`, {});
    await user.post(`/api/tasks/${a.id}/reopen`, {});
    expect((await habitsOf(user))[0]?.log).toMatchObject({ source: "user" });
  });

  it("archive hides it from Hoy; delete removes it", async () => {
    const { user } = await setupUser();
    await user.post("/api/habits", { name: "Meditar" });
    await user.patch("/api/habits/meditar", { active: false });
    expect(await habitsOf(user)).toHaveLength(0);
    expect((await user.get("/api/habits?includeArchived=true")).body.habits).toHaveLength(1);
    expect((await user.del("/api/habits/meditar")).status).toBe(204);
    expect((await user.get("/api/habits?includeArchived=true")).body.habits).toHaveLength(0);
  });

  it("API tokens may list and log habits, not create them", async () => {
    const { user } = await setupUser();
    await user.post("/api/habits", { name: "Gym" });
    await user.post("/api/auth/reauth", { pin: "482913" });
    const token = (await user.post("/api/tokens", { name: "sunday", scopes: ["read", "write"] })).body.token;
    const sunday = client("anon");
    const auth = { authorization: `Bearer ${token}` };
    expect((await sunday.request("POST", "/api/habits/gym/log", { body: {}, headers: auth })).status).toBe(200);
    expect((await sunday.request("GET", "/api/habits", { headers: auth })).body.habits[0].log.source).toBe("sunday");
    expect((await sunday.request("POST", "/api/habits", { body: { name: "Otro" }, headers: auth })).status).toBe(403);
  });
});

describe("sleep", () => {
  it("Me voy a dormir / Me levanté land on the wake-up date; corrections and validation", async () => {
    const { user } = await setupUser();
    setNow("2026-11-18T23:40:00-03:00");
    const bed = await user.post("/api/sleep/events", { type: "bed" });
    expect(bed.status).toBe(201);
    expect(bed.body).toMatchObject({ date: "2026-11-19", bedAt: "2026-11-18T23:40:00.000-03:00", wakeAt: null });
    setNow("2026-11-19T07:10:00-03:00");
    const wake = await user.post("/api/sleep/events", { type: "wake" });
    expect(wake.body).toMatchObject({ date: "2026-11-19", durationMinutes: 450 });

    // after midnight counts for the same morning
    const late = await user.post("/api/sleep/events", { type: "bed", at: "2026-11-19T00:30:00-03:00" });
    expect(late.body).toMatchObject({ date: "2026-11-19", durationMinutes: 400 });

    expect((await user.put("/api/sleep/2026-11-19", { quality: 4 })).body.quality).toBe(4);
    expect((await user.put("/api/sleep/2026-11-19", { wakeAt: "2026-11-19T00:10:00-03:00" })).status).toBe(400);
    expect((await user.post("/api/sleep/events", { type: "wake", at: "2026-11-19T09:00:00-03:00" })).status).toBe(400); // future

    // a night loaded by hand
    const manual = await user.put("/api/sleep/2026-11-18", {
      bedAt: "2026-11-17T23:00:00-03:00",
      wakeAt: "2026-11-18T06:30:00-03:00",
      quality: 3,
    });
    expect(manual.status).toBe(201);
    expect((await user.get("/api/sleep?from=2026-11-17&to=2026-11-19")).body.logs.map((l: { date: string }) => l.date)).toEqual([
      "2026-11-18",
      "2026-11-19",
    ]);
    expect((await user.del("/api/sleep/2026-11-18")).status).toBe(204);
  });
});

describe("cierre del día", () => {
  it("moves pending tasks to tomorrow, the Inbox or drops them (a recurring one moves on); edits keep the moves", async () => {
    const { user } = await setupUser();
    const t1 = (await user.post("/api/tasks", { title: "Pagar luz", dueDate: "2026-11-18", dueTime: "18:00" })).body;
    const t2 = (await user.post("/api/tasks", { title: "Ordenar placard", dueDate: "2026-11-18" })).body;
    const t3 = (await user.post("/api/tasks", { title: "Regar plantas", dueDate: "2026-11-18", rrule: "FREQ=DAILY" })).body;
    const t4 = (await user.post("/api/tasks", { title: "Atrasada", dueDate: "2026-11-15" })).body;

    const summary = (await user.get("/api/summary/day")).body;
    expect(summary.tasks.pending.map((t: { title: string }) => t.title)).toEqual(["Pagar luz", "Ordenar placard", "Regar plantas"]);
    expect(summary.tasks.overdue.map((t: { title: string }) => t.title)).toEqual(["Atrasada"]);
    expect(summary.review).toBeNull();

    const saved = await user.put("/api/reviews/2026-11-18", {
      mood: 4,
      note: "Buen día",
      highlights: ["Gym"],
      moves: [
        { taskId: t1.id, to: "tomorrow" },
        { taskId: t2.id, to: "inbox" },
        { taskId: t3.id, to: "drop" },
        { taskId: t4.id, to: "tomorrow" },
      ],
    });
    expect(saved.status).toBe(201);
    expect(saved.body.movedTaskIds).toHaveLength(4);
    expect((await user.get(`/api/tasks/${t1.id}`)).body).toMatchObject({ dueDate: "2026-11-19", dueTime: "18:00" });
    expect((await user.get(`/api/tasks/${t2.id}`)).body).toMatchObject({ dueDate: null });
    expect((await user.get(`/api/tasks/${t3.id}`)).body.status).toBe("cancelled");
    const tomorrow = (await user.get("/api/tasks?view=upcoming")).body.tasks.map((t: { title: string }) => t.title);
    expect(tomorrow).toEqual(expect.arrayContaining(["Pagar luz", "Atrasada", "Regar plantas"]));
    expect((await user.get("/api/tasks?view=inbox")).body.tasks.map((t: { title: string }) => t.title)).toEqual(["Ordenar placard"]);

    const edited = await user.put("/api/reviews/2026-11-18", { mood: 5, version: 1 });
    expect(edited.body).toMatchObject({ mood: 5, note: "Buen día", version: 2 });
    expect(edited.body.movedTaskIds).toHaveLength(4);
    expect((await user.put("/api/reviews/2026-11-18", { mood: 3, version: 1 })).status).toBe(409);
    expect((await user.put("/api/reviews/2026-11-19", { mood: 3 })).status).toBe(400); // tomorrow
    expect((await user.get("/api/reviews/2026-11-18")).body.review.mood).toBe(5);
  });
});

describe("history and metrics", () => {
  it("history per day and metrics per week", async () => {
    const { user } = await setupUser();
    setNow("2026-11-15T10:00:00-03:00");
    await user.post("/api/habits", { name: "Leer" }); // never checked
    setNow("2026-11-16T10:00:00-03:00");
    await user.post("/api/habits", { name: "Meditar" });
    const a = (await user.post("/api/tasks", { title: "A", dueDate: "2026-11-16" })).body;
    const b = (await user.post("/api/tasks", { title: "B", dueDate: "2026-11-15" })).body;
    await user.post(`/api/tasks/${a.id}/complete`, {});
    await user.post(`/api/tasks/${b.id}/complete`, {});
    await user.post("/api/habits/meditar/log", {});
    setNow("2026-11-17T07:00:00-03:00");
    await user.put("/api/sleep/2026-11-17", { bedAt: "2026-11-16T23:30:00-03:00", wakeAt: "2026-11-17T07:00:00-03:00", quality: 4 });
    await user.put("/api/reviews/2026-11-16", { mood: 3 });
    setNow("2026-11-18T21:00:00-03:00");
    await user.put("/api/sleep/2026-11-18", { bedAt: "2026-11-18T00:30:00-03:00", wakeAt: "2026-11-18T07:30:00-03:00" });

    const h = (await user.get("/api/history?month=2026-11")).body;
    expect(h.days).toHaveLength(18);
    expect(h.days.find((d: { date: string }) => d.date === "2026-11-16")).toMatchObject({
      tasksDone: 2,
      habitsMet: 1,
      habitsTotal: 2,
      mood: 3,
      reviewed: true,
    });
    expect(h.days.find((d: { date: string }) => d.date === "2026-11-17")).toMatchObject({ sleepMinutes: 450 });
    // a habit counts from the day it was created
    expect(h.days.find((d: { date: string }) => d.date === "2026-11-15")).toMatchObject({ habitsMet: 0, habitsTotal: 1 });

    const m = (await user.get("/api/metrics?range=week&date=2026-11-18")).body;
    expect(m).toMatchObject({ from: "2026-11-16", to: "2026-11-22" });
    expect(m.tasks).toMatchObject({ done: 2, onTime: 1, withDue: 2, onTimeRate: 0.5 });
    expect(m.tasks.buckets[0]).toEqual({ start: "2026-11-16", label: "L", done: 2 });
    expect(m.sleep).toMatchObject({ nights: 2, avgMinutes: 435, avgBedTime: "00:00", avgWakeTime: "07:15", avgQuality: 4 });
    expect(m.mood).toEqual({ days: 1, avg: 3 });
    expect(m.habits.map((x: { name: string; met: number; total: number }) => [x.name, x.met, x.total])).toEqual([
      ["Leer", 0, 2],
      ["Meditar", 1, 2],
    ]);
    const y = (await user.get("/api/metrics?range=year&date=2026-11-18")).body;
    expect(y.tasks.buckets).toHaveLength(12);
    expect(y.tasks.buckets[10]).toMatchObject({ label: "nov", done: 2 });
  });

  it("counts what was created, by hand and by Sunday (created_at is the database clock: run at the real now)", async () => {
    await resetAll(Temporal.Now.instant().toString());
    const { user } = await setupUser();
    await user.post("/api/tasks", { title: "A mano" });
    await user.post("/api/reminders", { title: "Recordatorio", fireAt: Temporal.Now.instant().add({ hours: 2 }).toString() });
    await user.post("/api/auth/reauth", { pin: "482913" });
    const token = (await user.post("/api/tokens", { name: "sunday", scopes: ["read", "write"] })).body.token;
    await client("anon").request("POST", "/api/tasks", { body: { title: "De Sunday" }, headers: { authorization: `Bearer ${token}` } });
    const m = (await user.get("/api/metrics?range=week")).body;
    expect(m.tasks.created).toBe(2);
    expect(m.sources).toEqual({ user: 2, sunday: 1 });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@/contract/openapi";
import { SUNDAY_OPERATIONS } from "@/contract/sunday";
import { closeDb, getDb } from "@/server/db/client";
import { calendarSource, externalEvent } from "@/server/db/schema";
import { client, pushes, resetAll, setNow, setupUser } from "../helpers/api";
import { coverage } from "../helpers/contract";

/**
 * What Sunday does, end to end, through its token only (the app just sets up the token, a habit and a phone).
 * The tests run in order on one database, like a day of conversation. The last one checks that every Sunday
 * operation was called and validated against the contract.
 */
let s: ReturnType<typeof as>;
let googleId = "";

function as(token: string) {
  const c = client("anon");
  const auth = { authorization: `Bearer ${token}` };
  return {
    get: (p: string) => c.get(p, auth),
    post: (p: string, b?: unknown) => c.post(p, b, auth),
    patch: (p: string, b?: unknown) => c.patch(p, b, auth),
    put: (p: string, b?: unknown) => c.put(p, b, auth),
    del: (p: string) => c.del(p, undefined, auth),
  };
}

beforeAll(async () => {
  await resetAll("2026-10-19T08:00:00-03:00"); // Monday morning
  const { user } = await setupUser();
  await user.post("/api/push/subscribe", { endpoint: "https://push.test/phone", keys: { p256dh: "k", auth: "a" } });
  await user.post("/api/habits", { name: "Gym", taskTag: "gym" });
  await user.post("/api/habits", { name: "Lectura", kind: "numeric", unit: "páginas", targetCount: 20 });
  const token = await user.post("/api/tokens", { name: "sunday", scopes: ["read", "write", "notify"] });
  s = as(token.body.token);
  // a Google Calendar event (read-only) today at 09:30
  const [src] = await getDb()
    .insert(calendarSource)
    .values({ kind: "google", externalCalendarId: "work@group", name: "Trabajo", color: "#4285f4" })
    .returning();
  const [ext] = await getDb()
    .insert(externalEvent)
    .values({
      sourceId: src?.id ?? "",
      externalId: "daily-1",
      title: "Daily",
      startsAt: new Date("2026-10-19T12:30:00Z"),
      endsAt: new Date("2026-10-19T12:45:00Z"),
    })
    .returning();
  googleId = ext?.id ?? "";
});
afterAll(() => closeDb());

describe("a day with Sunday", () => {
  it("“¿qué día es?” and “¿qué tengo hoy?”", async () => {
    const now = await s.get("/api/now");
    expect(now.body.weekday).toBe("lunes");
    const day = await s.get("/api/overview");
    expect(day.body.events).toHaveLength(1);
    expect(day.body.events[0]).toMatchObject({ title: "Daily", readOnly: true, whenText: "lunes 19 de octubre, 09:30–09:45" });
  });

  it("“recordame mañana a las 9 llamar al contador” (retry included) and “anotá comprar pintura”", async () => {
    const body = { title: "Llamar al contador", dueDate: "2026-10-20T09:00", reminderAt: "2026-10-20T09:00", clientId: "c-contador" };
    const first = await s.post("/api/tasks", body);
    const retry = await s.post("/api/tasks", body); // the tool call timed out and Sunday tried again
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.reminder.id).toBe(first.body.reminder.id);
    const inbox = await s.post("/api/tasks", { title: "Comprar pintura", clientId: "c-pintura" });
    expect(inbox.body.dueDate).toBeNull();
    const lists = await s.get("/api/lists");
    expect(inbox.body.listId).toBe(lists.body.lists[0].id);
    const tomorrow = await s.get("/api/overview?from=2026-10-20");
    expect(tomorrow.body.tasks.map((t: { title: string }) => t.title)).toEqual(["Llamar al contador"]);
    expect(tomorrow.body.reminders[0].whenText).toBe("martes 20 de octubre, 09:00");
  });

  it("“pasá lo del contador al jueves” → search, then update", async () => {
    const found = await s.get("/api/search?q=contador");
    const task = found.body.results.find((r: { type: string }) => r.type === "task").task;
    const moved = await s.patch(`/api/tasks/${task.id}`, { dueDate: "2026-10-22" });
    expect(moved.body).toMatchObject({ dueDate: "2026-10-22", dueTime: "09:00", whenText: "jueves 22 de octubre, 09:00" });
    expect((await s.get(`/api/tasks/${task.id}`)).body.version).toBe(moved.body.version);
    expect((await s.get("/api/tasks?view=upcoming")).body.tasks).toHaveLength(1);
  });

  it("a list, a weekly chore, done and undone", async () => {
    expect((await s.post("/api/lists", { name: "Casa" })).status).toBe(201);
    const chore = await s.post("/api/tasks", {
      title: "Sacar la basura",
      list: "casa",
      dueDate: "2026-10-19",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    const done = await s.post(`/api/tasks/${chore.body.id}/complete`);
    expect(done.body.next.whenText).toBe("lunes 26 de octubre");
    const undone = await s.post(`/api/tasks/${chore.body.id}/reopen`, {});
    expect(undone.body.status).toBe("open");
    const pintura = (await s.get("/api/search?q=pintura")).body.results[0].task;
    expect((await s.del(`/api/tasks/${pintura.id}`)).status).toBe(204);
  });

  it("reminders: create, move, snooze, done, cancel", async () => {
    const r = await s.post("/api/reminders", { title: "Sacar la ropa", fireAt: "2026-10-19T18:00", clientId: "c-ropa" });
    expect((await s.get(`/api/reminders/${r.body.id}`)).body.title).toBe("Sacar la ropa");
    const moved = await s.patch(`/api/reminders/${r.body.id}`, { fireAt: "2026-10-19T18:30" });
    expect(moved.body.whenText).toBe("lunes 19 de octubre, 18:30");
    const snoozed = await s.post(`/api/reminders/${r.body.id}/snooze`, { minutes: 30 });
    expect(snoozed.body.fireAt).toBe("2026-10-19T08:30:00.000-03:00"); // 30 min from now
    expect((await s.post(`/api/reminders/${r.body.id}/done`)).body.status).toBe("done");
    const other = await s.post("/api/reminders", { title: "Regar", fireAt: "2026-10-19T20:00" });
    expect((await s.del(`/api/reminders/${other.body.id}`)).status).toBe(204);
    const upcoming = await s.get("/api/reminders?view=upcoming");
    expect(upcoming.body.reminders.map((x: { title: string }) => x.title)).toEqual(["Llamar al contador"]);
  });

  it("events: create, move, delete; Google is read-only but can get a Recordarme", async () => {
    const e = await s.post("/api/events", {
      title: "Dentista",
      startsAt: "2026-10-21T10:00",
      endsAt: "2026-10-21T11:00",
      clientId: "c-dentista",
    });
    expect((await s.get(`/api/events/${e.body.id}`)).body.whenText).toBe("miércoles 21 de octubre, 10:00–11:00");
    const moved = await s.patch(`/api/events/${e.body.id}`, { startsAt: "2026-10-21T15:00", endsAt: "2026-10-21T16:00" });
    expect(moved.body.whenText).toBe("miércoles 21 de octubre, 15:00–16:00");
    const week = await s.get("/api/events?from=2026-10-19&to=2026-10-25");
    expect(week.body.events.map((x: { title: string }) => x.title)).toEqual(["Daily", "Dentista"]);

    const google = await s.patch(`/api/events/${googleId}`, { title: "Otra" });
    expect(google.status).toBe(409);
    expect(google.body.error.code).toBe("READ_ONLY_EVENT");
    const remind = await s.post(`/api/external-events/${googleId}/remind`, { minutesBefore: 10 });
    expect(remind.body.whenText).toBe("lunes 19 de octubre, 09:20");
    expect((await s.del(`/api/events/${e.body.id}`)).status).toBe(204);
  });

  it("habits by slug, a tagged task, sleep", async () => {
    expect((await s.post("/api/habits/lectura/log", { value: 25 })).body.period.met).toBe(true);
    await s
      .post("/api/tasks", { title: "Ir al gym", dueDate: "2026-10-19", tags: ["gym"] })
      .then((t) => s.post(`/api/tasks/${t.body.id}/complete`));
    const habits = await s.get("/api/habits");
    expect(habits.body.habits.map((h: { slug: string; log: { done: boolean } | null }) => [h.slug, h.log?.done])).toEqual([
      ["gym", true],
      ["lectura", true],
    ]);
    expect((await s.post("/api/habits/gym/log", { done: false })).body.log).toBeNull();
    expect((await s.get("/api/habits/gym/logs?from=2026-10-13&to=2026-10-19")).status).toBe(200);

    setNow("2026-10-19T23:40:00-03:00");
    expect((await s.post("/api/sleep/events", { type: "bed" })).body.date).toBe("2026-10-20");
    setNow("2026-10-20T07:10:00-03:00");
    const night = await s.post("/api/sleep/events", { type: "wake" });
    expect(night.body.durationMinutes).toBe(450);
    expect((await s.put("/api/sleep/2026-10-20", { quality: 4 })).body.quality).toBe(4);
    expect((await s.get("/api/sleep?from=2026-10-14&to=2026-10-20")).body.logs).toHaveLength(1);
    setNow("2026-10-19T21:30:00-03:00");
  });

  it("the evening: summary, closing the day, a push; history and metrics", async () => {
    const summary = await s.get("/api/summary/day");
    const pending = summary.body.tasks.pending as Array<{ id: string; title: string }>;
    expect(pending.map((t) => t.title)).toEqual(["Sacar la basura"]);
    const saved = await s.put("/api/reviews/2026-10-19", {
      mood: 4,
      highlights: ["Fui al dentista"],
      moves: pending.map((t) => ({ taskId: t.id, to: "tomorrow" })),
    });
    expect(saved.status).toBe(201);
    expect((await s.get("/api/reviews/2026-10-19")).body.review.mood).toBe(4);
    const n = await s.post("/api/notify", { title: "Cerraste el día", body: "Mañana: dentista y contador." });
    expect(n.body.delivered).toBe(1);
    expect(pushes.at(-1)).toMatchObject({ type: "notice", url: "/" });
    expect((await s.get("/api/history?month=2026-10")).body.days.length).toBeGreaterThan(0);
    expect((await s.get("/api/metrics?range=week")).body.range).toBe("week");
  });

  it("every Sunday operation was called and matched the contract", () => {
    const missing = SUNDAY_OPERATIONS.filter((id) => {
      const r = routes.find((x) => x.operationId === id);
      return !r || ![...coverage].some((c) => c.startsWith(`${r.method.toUpperCase()} ${r.path} 2`));
    });
    expect(missing).toEqual([]);
  });
});

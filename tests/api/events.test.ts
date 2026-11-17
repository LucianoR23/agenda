import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { materializeEventReminders } from "@/server/domain/event-reminders";
import { now } from "@/server/domain/time";
import { dispatchReminders } from "@/server/jobs/reminders";
import { pushes, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll("2026-11-16T08:00:00-03:00")); // Monday 08:00
afterAll(() => closeDb());

const upcoming = async (user: Awaited<ReturnType<typeof setupUser>>["user"]) =>
  (await user.get("/api/reminders?view=upcoming")).body.reminders as Array<{
    title: string;
    fireAt: string;
    eventId: string | null;
    body: string;
  }>;

describe("events API", () => {
  it("timed event: create, get, move (keeps the duration), delete", async () => {
    const { user } = await setupUser();
    const created = await user.post("/api/events", {
      title: "Dentista",
      location: "Av. Santa Fe 1234",
      startsAt: "2026-11-18T10:00:00-03:00",
      endsAt: "2026-11-18T11:00:00-03:00",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      allDay: false,
      startsAt: "2026-11-18T10:00:00.000-03:00",
      timezone: "America/Buenos_Aires",
      source: "user",
      reminderOffsets: [],
    });
    const id = created.body.id;
    const moved = await user.patch(`/api/events/${id}`, { startsAt: "2026-11-18T15:00:00-03:00", version: 1 });
    expect(moved.body).toMatchObject({ startsAt: "2026-11-18T15:00:00.000-03:00", endsAt: "2026-11-18T16:00:00.000-03:00", version: 2 });
    expect((await user.patch(`/api/events/${id}`, { title: "x", version: 1 })).status).toBe(409);
    expect((await user.del(`/api/events/${id}`)).status).toBe(204);
    expect((await user.get(`/api/events/${id}`)).status).toBe(404);
  });

  it("validates timed XOR all-day", async () => {
    const { user } = await setupUser();
    expect((await user.post("/api/events", { title: "x" })).status).toBe(400);
    expect((await user.post("/api/events", { title: "x", allDay: true, startsAt: "2026-11-18T10:00:00-03:00" })).status).toBe(400);
    expect((await user.post("/api/events", { title: "x", startDate: "2026-11-18" })).status).toBe(400);
    expect(
      (await user.post("/api/events", { title: "x", startsAt: "2026-11-18T10:00:00-03:00", endsAt: "2026-11-18T09:00:00-03:00" })).status,
    ).toBe(400);
    expect((await user.post("/api/events", { title: "x", allDay: true, startDate: "2026-11-18", endDate: "2026-11-18" })).status).toBe(400);
    expect((await user.post("/api/events", { title: "x", startsAt: "2026-11-18T10:00:00-03:00", rrule: "FREQ=MINUTELY" })).status).toBe(
      400,
    );
  });

  it("all-day defaults to one day; switching to timed and back converts", async () => {
    const { user } = await setupUser();
    const e = (await user.post("/api/events", { title: "Cumple de mamá", allDay: true, startDate: "2026-11-20" })).body;
    expect(e).toMatchObject({ startDate: "2026-11-20", endDate: "2026-11-21", startsAt: null });
    const timed = (await user.patch(`/api/events/${e.id}`, { allDay: false, startsAt: "2026-11-20T20:00:00-03:00" })).body;
    expect(timed).toMatchObject({ allDay: false, startDate: null, endsAt: "2026-11-20T21:00:00.000-03:00" });
    const back = (await user.patch(`/api/events/${e.id}`, { allDay: true })).body;
    expect(back).toMatchObject({ allDay: true, startDate: "2026-11-20", endDate: "2026-11-21", startsAt: null });
  });

  it("lists a range: recurring events expanded, all-day first, sorted", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", {
      title: "Inglés",
      startsAt: "2026-11-17T19:00:00-03:00",
      endsAt: "2026-11-17T20:00:00-03:00",
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
    });
    await user.post("/api/events", { title: "Feriado", allDay: true, startDate: "2026-11-19" });
    await user.post("/api/events", { title: "Dentista", startsAt: "2026-11-19T10:00:00-03:00" });
    await user.post("/api/events", { title: "Fuera", startsAt: "2026-12-19T10:00:00-03:00" });
    const r = await user.get("/api/events?from=2026-11-16&to=2026-11-22");
    expect(r.status).toBe(200);
    expect(
      r.body.events.map((e: { title: string; startsAt: string | null; startDate: string | null }) => [e.title, e.startsAt ?? e.startDate]),
    ).toEqual([
      ["Inglés", "2026-11-17T19:00:00.000-03:00"],
      ["Feriado", "2026-11-19"],
      ["Dentista", "2026-11-19T10:00:00.000-03:00"],
      ["Inglés", "2026-11-19T19:00:00.000-03:00"],
    ]);
    const ingles = r.body.events.filter((e: { title: string }) => e.title === "Inglés");
    expect(new Set(ingles.map((e: { id: string }) => e.id)).size).toBe(2); // unique per occurrence
    expect(ingles[0]).toMatchObject({ recurring: true, readOnly: false, source: "local", eventId: ingles[1].eventId });
    expect((await user.get("/api/events?from=2026-11-16&to=2027-03-01")).status).toBe(400); // > 92 days
  });

  it("search finds events", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", { title: "Turno médico", location: "Clínica Güemes", startsAt: "2026-11-19T10:00:00-03:00" });
    const found = (await user.get("/api/search?q=guemes")).body.results;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "event", event: { title: "Turno médico" } });
  });
});

describe("overlaps", () => {
  const at = (h: string) => `2026-11-18T${h}:00-03:00`;

  it("create and update return the events they overlap; touching ends and all-day events don't count", async () => {
    const { user } = await setupUser();
    const meeting = (await user.post("/api/events", { title: "Reunión", startsAt: at("10:00"), endsAt: at("11:00") })).body;
    expect(meeting.conflicts).toEqual([]);
    await user.post("/api/events", { title: "Feriado", allDay: true, startDate: "2026-11-18" });

    const clash = await user.post("/api/events", { title: "Dentista", startsAt: at("10:30"), endsAt: at("11:30") });
    expect(clash.status).toBe(201); // never blocks
    expect(clash.body.conflicts).toMatchObject([
      { eventId: meeting.id, title: "Reunión", whenText: "miércoles 18 de noviembre, 10:00–11:00" },
    ]);

    const after = await user.post("/api/events", { title: "Café", startsAt: at("11:30"), endsAt: at("12:00") });
    expect(after.body.conflicts).toEqual([]); // starts when the dentist ends

    // a moment inside the meeting (no end) overlaps; moving out clears it; an event never conflicts with itself
    const call = await user.post("/api/events", { title: "Llamada", startsAt: at("10:15") });
    expect(call.body.conflicts.map((c: { title: string }) => c.title)).toEqual(["Reunión"]);
    const moved = await user.patch(`/api/events/${call.body.id}`, { startsAt: at("13:00") });
    expect(moved.body.conflicts).toEqual([]);
    const self = await user.patch(`/api/events/${meeting.id}`, { title: "Reunión de equipo" });
    expect(self.body.conflicts.map((c: { title: string }) => c.title)).toEqual(["Dentista"]);

    const allDay = await user.post("/api/events", { title: "Viaje", allDay: true, startDate: "2026-11-18" });
    expect(allDay.body.conflicts).toEqual([]);
  });

  it("recurring events and Google events count; a task with a time reports what's at that moment", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", {
      title: "Gym",
      startsAt: "2026-11-16T19:00:00-03:00",
      endsAt: "2026-11-16T20:00:00-03:00",
      rrule: "FREQ=DAILY",
    });
    const e = await user.post("/api/events", { title: "Cena", startsAt: at("19:30"), endsAt: at("21:00") });
    expect(e.body.conflicts).toMatchObject([{ title: "Gym", startsAt: "2026-11-18T19:00:00.000-03:00", recurring: true }]);

    const task = await user.post("/api/tasks", { title: "Llamar a Juan", dueDate: "2026-11-18T19:45" });
    expect(task.body.conflicts.map((c: { title: string }) => c.title)).toEqual(["Gym", "Cena"]);
    const noTime = await user.post("/api/tasks", { title: "Comprar pan", dueDate: "2026-11-18" });
    expect(noTime.body.conflicts).toBeUndefined();
  });

  it("checkAvailability: busy slots, all-day context, validation", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", { title: "Reunión", startsAt: at("10:00"), endsAt: at("11:00") });
    await user.post("/api/events", { title: "Feriado", allDay: true, startDate: "2026-11-18" });

    const busy = await user.get("/api/availability?from=2026-11-18T09:00&to=2026-11-18T10:30");
    expect(busy.status).toBe(200);
    expect(busy.body).toMatchObject({ from: "2026-11-18T09:00:00.000-03:00", to: "2026-11-18T10:30:00.000-03:00", free: false });
    expect(busy.body.busy.map((e: { title: string }) => e.title)).toEqual(["Reunión"]);
    expect(busy.body.allDay.map((e: { title: string }) => e.title)).toEqual(["Feriado"]);

    const free = await user.get("/api/availability?from=2026-11-18T11:00&to=2026-11-18T12:00");
    expect(free.body).toMatchObject({ free: true, busy: [] });
    // a range ending at midnight doesn't reach into the next day
    const evening = await user.get("/api/availability?from=2026-11-17T20:00&to=2026-11-18T00:00");
    expect(evening.body.allDay).toEqual([]);

    expect((await user.get("/api/availability?from=2026-11-18T12:00&to=2026-11-18T11:00")).status).toBe(400);
    expect((await user.get("/api/availability?from=2026-11-18T12:00&to=2027-01-18T11:00")).status).toBe(400);
  });
});

describe("event reminders", () => {
  it("offsets become reminders within 48 h; moving the event moves them; deleting removes them", async () => {
    const { user } = await setupUser();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/phone", keys: { p256dh: "k", auth: "a" } });
    const e = (
      await user.post("/api/events", {
        title: "Dentista",
        location: "Av. Santa Fe 1234",
        startsAt: "2026-11-17T10:00:00-03:00",
        reminderOffsets: [60, 15, 15],
      })
    ).body;
    expect(e.reminderOffsets).toEqual([60, 15]);
    let r = await upcoming(user);
    expect(r.map((x) => [x.fireAt, x.body])).toEqual([
      ["2026-11-17T09:00:00.000-03:00", "A las 10:00 · Av. Santa Fe 1234"],
      ["2026-11-17T09:45:00.000-03:00", "A las 10:00 · Av. Santa Fe 1234"],
    ]);
    expect(r[0]?.eventId).toBe(e.id);

    await user.patch(`/api/events/${e.id}`, { startsAt: "2026-11-17T11:00:00-03:00", reminderOffsets: [30] });
    r = await upcoming(user);
    expect(r.map((x) => x.fireAt)).toEqual(["2026-11-17T10:30:00.000-03:00"]);

    // the job is idempotent
    await materializeEventReminders(getDb(), now());
    expect(await upcoming(user)).toHaveLength(1);

    setNow("2026-11-17T10:30:05-03:00");
    await dispatchReminders(getDb(), now());
    expect(pushes.at(-1)).toMatchObject({ title: "Dentista", body: "A las 11:00 · Av. Santa Fe 1234", url: "/calendario" });

    const other = (await user.post("/api/events", { title: "Clase", startsAt: "2026-11-18T10:00:00-03:00", reminderOffsets: [10] })).body;
    expect((await upcoming(user)).map((x) => x.title)).toEqual(["Clase"]);
    await user.del(`/api/events/${other.id}`);
    expect(await upcoming(user)).toHaveLength(0);
  });

  it("recurring events get reminders only for the next 48 h; the job adds the rest as time passes; a cancelled one stays cancelled", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", { title: "Pastilla", startsAt: "2026-11-16T21:00:00-03:00", rrule: "FREQ=DAILY", reminderOffsets: [0] });
    let r = await upcoming(user);
    expect(r.map((x) => x.fireAt)).toEqual(["2026-11-16T21:00:00.000-03:00", "2026-11-17T21:00:00.000-03:00"]);
    expect(r[0]?.body).toBe("Ahora");

    // cancel tomorrow's: the job must not bring it back
    const full = (await user.get("/api/reminders?view=upcoming")).body.reminders;
    await user.del(`/api/reminders/${full[1].id}`);
    setNow("2026-11-17T08:00:00-03:00");
    await materializeEventReminders(getDb(), now());
    r = await upcoming(user);
    expect(r.map((x) => x.fireAt)).toEqual(["2026-11-16T21:00:00.000-03:00", "2026-11-18T21:00:00.000-03:00"]);
  });

  it("all-day events count offsets back from 09:00", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", { title: "Cumple de Juan", allDay: true, startDate: "2026-11-17", reminderOffsets: [0, 1440] });
    expect((await upcoming(user)).map((x) => [x.fireAt, x.body])).toEqual([
      ["2026-11-16T09:00:00.000-03:00", "Todo el día"],
      ["2026-11-17T09:00:00.000-03:00", "Todo el día"],
    ]);
  });
});

describe("overview", () => {
  it("events, tasks, reminders and overdue for a day", async () => {
    const { user } = await setupUser();
    await user.post("/api/events", { title: "Dentista", startsAt: "2026-11-16T10:00:00-03:00" });
    await user.post("/api/tasks", { title: "Pagar luz", dueDate: "2026-11-16", dueTime: "18:00" });
    await user.post("/api/tasks", { title: "Comprar pan", dueDate: "2026-11-16" });
    await user.post("/api/tasks", { title: "Atrasada", dueDate: "2026-11-13" });
    await user.post("/api/reminders", { title: "Llamar", fireAt: "2026-11-16T12:00:00-03:00" });
    await user.post("/api/reminders", { title: "Mañana", fireAt: "2026-11-17T12:00:00-03:00" });
    const o = (await user.get("/api/overview")).body;
    expect(o).toMatchObject({ from: "2026-11-16", to: "2026-11-16" });
    expect(o.events.map((e: { title: string }) => e.title)).toEqual(["Dentista"]);
    expect(o.tasks.map((t: { title: string }) => t.title)).toEqual(["Pagar luz", "Comprar pan"]);
    expect(o.reminders.map((r: { title: string }) => r.title)).toEqual(["Llamar"]);
    expect(o.overdue.map((t: { title: string }) => t.title)).toEqual(["Atrasada"]);
    expect((await user.get("/api/overview?from=2026-11-16&to=2026-12-31")).status).toBe(400);
  });
});

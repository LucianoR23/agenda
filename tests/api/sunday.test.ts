import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SUNDAY_OPERATIONS } from "@/contract/sunday";
import { handle } from "@/server/api";
import { closeDb } from "@/server/db/client";
import { TOKEN_LIMITS } from "@/server/http/ratelimit";
import { anon, client, pushes, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll());
afterAll(() => closeDb());

type Scope = "read" | "write" | "notify";

/** Lemy's app (session) + Sunday (the "sunday" token, no cookies). */
async function sunday(scopes: Scope[] = ["read", "write", "notify"]) {
  const { user } = await setupUser();
  const r = await user.post("/api/tokens", { name: "sunday", scopes });
  if (r.status !== 201) throw new Error(`token: ${r.status}`);
  const auth = { authorization: `Bearer ${r.body.token}` };
  const s = client("anon");
  return {
    user,
    token: r.body.token as string,
    get: (p: string) => s.get(p, auth),
    post: (p: string, b?: unknown) => s.post(p, b, auth),
    patch: (p: string, b?: unknown) => s.patch(p, b, auth),
    put: (p: string, b?: unknown) => s.put(p, b, auth),
    del: (p: string) => s.del(p, undefined, auth),
  };
}

describe("openapi.sunday.json", () => {
  it("has exactly Sunday's operations, token auth only, no header parameters", async () => {
    const r = await anon().get("/api/openapi.sunday.json");
    expect(r.status).toBe(200);
    const ops: Array<{ operationId: string; security: unknown[]; parameters?: Array<{ in: string }>; description: string }> = [];
    for (const item of Object.values(r.body.paths as Record<string, Record<string, (typeof ops)[number]>>))
      ops.push(...Object.values(item));
    expect(ops.map((o) => o.operationId).sort()).toEqual([...SUNDAY_OPERATIONS].sort());
    for (const o of ops) {
      expect(o.security).toEqual([{ apiToken: [expect.stringMatching(/^(read|write|notify)$/)] }]);
      expect(o.parameters?.filter((p) => p.in === "header") ?? []).toEqual([]);
      expect(o.description.length).toBeGreaterThan(30);
    }
    expect(r.body.components.securitySchemes.session).toBeUndefined();
    expect(r.body.servers).toEqual([{ url: "https://agenda.lemydev.com" }]);
    expect(JSON.stringify(r.body)).not.toContain('"examples"');
  });
});

describe("getNow", () => {
  it("the user's date, weekday and week", async () => {
    const s = await sunday(["read"]);
    const r = await s.get("/api/now");
    expect(r.body).toEqual({
      now: "2026-10-19T06:55:00.000-03:00",
      date: "2026-10-19",
      time: "06:55",
      weekday: "lunes",
      whenText: "lunes 19 de octubre, 06:55",
      timezone: "America/Buenos_Aires",
      utcOffset: "-03:00",
      tomorrow: "2026-10-20",
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
    });
  });
});

describe("creates from Sunday", () => {
  it("clientId: the same create again returns the task (200) and updates what changed; never a duplicate", async () => {
    const s = await sunday();
    const body = { title: "Llamar al contador", dueDate: "2026-10-20", clientId: "sunday-contador" };
    const first = await s.post("/api/tasks", body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      source: "sunday",
      whenText: "martes 20 de octubre",
      url: `https://agenda.lemydev.com/tareas?task=${first.body.id}`,
    });
    const again = await s.post("/api/tasks", body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, version: 1 });
    const moved = await s.post("/api/tasks", { ...body, dueDate: "2026-10-21T09:00" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id: first.body.id, dueDate: "2026-10-21", dueTime: "09:00", version: 2 });
    expect(moved.body.whenText).toBe("miércoles 21 de octubre, 09:00");
    expect((await s.get("/api/tasks?view=all")).body.tasks).toHaveLength(1);

    await s.del(`/api/tasks/${first.body.id}`);
    const reused = await s.post("/api/tasks", body);
    expect(reused.status).toBe(409);
    expect(reused.body.error.message).toMatch(/Usá otro clientId/);
  });

  it("dueDate with a time, a list by name (case and accents aside) and reminderAt", async () => {
    const s = await sunday();
    await s.user.post("/api/lists", { name: "Café" });
    const r = await s.post("/api/tasks", {
      title: "Comprar granos",
      dueDate: "2026-10-20T18:30",
      list: "cafe",
      reminderAt: "2026-10-20T18:00",
      clientId: "granos",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ dueDate: "2026-10-20", dueTime: "18:30", dueAt: "2026-10-20T18:30:00.000-03:00" });
    expect(r.body.reminder).toMatchObject({
      taskId: r.body.id,
      fireAt: "2026-10-20T18:00:00.000-03:00",
      whenText: "martes 20 de octubre, 18:00",
      source: "sunday",
    });
    // same clientId with a new reminderAt moves that reminder instead of adding one
    const again = await s.post("/api/tasks", { title: "Comprar granos", list: "Café", reminderAt: "2026-10-20T17:30", clientId: "granos" });
    expect(again.status).toBe(200);
    expect(again.body.reminder).toMatchObject({ id: r.body.reminder.id, fireAt: "2026-10-20T17:30:00.000-03:00" });
    expect((await s.get("/api/reminders")).body.reminders).toHaveLength(1);

    const unknown = await s.post("/api/tasks", { title: "Pintura", list: "Ferretería" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toBe(
      'No hay una lista "Ferretería". Las listas son: Inbox, Café. Usá una de esas o creala con createTaskList.',
    );
    const both = await s.post("/api/tasks", { title: "x", list: "Café", listId: r.body.listId });
    expect(both.status).toBe(400);
  });

  it("updateTask takes a list name and a date-time", async () => {
    const s = await sunday();
    await s.user.post("/api/lists", { name: "Casa" });
    const t = await s.post("/api/tasks", { title: "Sacar la basura" });
    const r = await s.patch(`/api/tasks/${t.body.id}`, { list: "CASA", dueDate: "2026-10-22T08:00" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dueDate: "2026-10-22", dueTime: "08:00", whenText: "jueves 22 de octubre, 08:00" });
    const lists = (await s.get("/api/lists")).body.lists as Array<{ id: string; name: string }>;
    expect(r.body.listId).toBe(lists.find((l) => l.name === "Casa")?.id);
  });

  it("reminders and events: times without offset are local; clientId upserts", async () => {
    const s = await sunday();
    const rem = await s.post("/api/reminders", { title: "Sacar la ropa", fireAt: "2026-10-19T18:00", clientId: "ropa" });
    expect(rem.status).toBe(201);
    expect(rem.body).toMatchObject({
      fireAt: "2026-10-19T18:00:00.000-03:00",
      whenText: "lunes 19 de octubre, 18:00",
      url: `https://agenda.lemydev.com/recordatorios?reminder=${rem.body.id}`,
    });
    expect(
      (await s.post("/api/reminders", { title: "Sacar la ropa", fireAt: "2026-10-19T18:00:00-03:00", clientId: "ropa" })).body.version,
    ).toBe(1);
    const later = await s.post("/api/reminders", { title: "Sacar la ropa", fireAt: "2026-10-19T19:00", clientId: "ropa" });
    expect(later.status).toBe(200);
    expect(later.body).toMatchObject({ id: rem.body.id, fireAt: "2026-10-19T19:00:00.000-03:00", version: 2 });

    const ev = { title: "Dentista", startsAt: "2026-10-21T10:00", endsAt: "2026-10-21T11:00", reminderOffsets: [60], clientId: "dentista" };
    const e1 = await s.post("/api/events", ev);
    expect(e1.status).toBe(201);
    expect(e1.body).toMatchObject({
      startsAt: "2026-10-21T10:00:00.000-03:00",
      whenText: "miércoles 21 de octubre, 10:00–11:00",
      url: `https://agenda.lemydev.com/calendario?event=${e1.body.id}`,
    });
    const e2 = await s.post("/api/events", ev);
    expect(e2.status).toBe(200);
    expect(e2.body.version).toBe(1);
    const e3 = await s.post("/api/events", { ...ev, startsAt: "2026-10-21T15:00", endsAt: "2026-10-21T16:00" });
    expect(e3.body).toMatchObject({ id: e1.body.id, whenText: "miércoles 21 de octubre, 15:00–16:00" });
    const allDay = await s.post("/api/events", { title: "Viaje", allDay: true, startDate: "2026-10-23", endDate: "2026-10-26" });
    expect(allDay.body.whenText).toBe("del viernes 23 de octubre al domingo 25 de octubre (todo el día)");

    const snoozed = await s.post(`/api/reminders/${rem.body.id}/snooze`, { until: "2026-10-19T20:30" });
    expect(snoozed.body.fireAt).toBe("2026-10-19T20:30:00.000-03:00");
    const bad = await s.post("/api/reminders", { title: "x", fireAt: "mañana" });
    expect(bad.status).toBe(400);
  });
});

describe("sendPushNotification", () => {
  it("pushes to every device, only to allowed links, at most 20 a day", async () => {
    const s = await sunday();
    await s.user.post("/api/push/subscribe", { endpoint: "https://push.test/phone", keys: { p256dh: "k", auth: "a" } });
    const r = await s.post("/api/notify", {
      title: "Listo",
      body: "Terminé el resumen",
      url: "https://sunday.lemydev.com/c/1",
      tag: "resumen",
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ delivered: 1, failed: 0, remainingToday: 19 });
    expect(pushes[0]).toMatchObject({ type: "notice", title: "Listo", url: "https://sunday.lemydev.com/c/1", tag: "resumen" });

    expect((await s.post("/api/notify", { title: "a", body: "b", url: "/tareas" })).status).toBe(200);
    const evil = await s.post("/api/notify", { title: "a", body: "b", url: "https://evil.example/x" });
    expect(evil.status).toBe(400);
    expect((await s.post("/api/notify", { title: "a", body: "b", url: "http://sunday.lemydev.com" })).status).toBe(400);
    expect((await s.post("/api/notify", { title: "x".repeat(61), body: "b" })).status).toBe(400);

    for (let i = 2; i < 20; i++) expect((await s.post("/api/notify", { title: `n${i}`, body: "b" })).status).toBe(200);
    const over = await s.post("/api/notify", { title: "una más", body: "b" });
    expect(over.status).toBe(429);
    expect(over.body.error.message).toMatch(/usá createReminder/);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    setNow("2026-10-20T07:00:00-03:00"); // the window rolls
    expect((await s.post("/api/notify", { title: "mañana", body: "b" })).status).toBe(200);
  });

  it("needs the notify scope", async () => {
    const s = await sunday(["read", "write"]);
    const r = await s.post("/api/notify", { title: "a", body: "b" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("INSUFFICIENT_SCOPE");
  });
});

describe("rate limit per token", () => {
  it(`${TOKEN_LIMITS.perMinute} a minute, then 429 with Retry-After; a minute later it's open again`, async () => {
    const s = await sunday(["read"]);
    for (let i = 0; i < TOKEN_LIMITS.perMinute; i++) expect((await s.get("/api/now")).status).toBe(200);
    const r = await s.get("/api/now");
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("RATE_LIMITED");
    expect(r.headers.get("retry-after")).toBe("60");
    // the app (session) isn't limited
    expect((await s.user.get("/api/now")).status).toBe(200);
    setNow("2026-10-19T06:56:01-03:00");
    expect((await s.get("/api/now")).status).toBe(200);
  });
});

describe("CORS", () => {
  const raw = (method: string, path: string, headers: Record<string, string>) =>
    handle(new Request(`https://agenda.lemydev.com${path}`, { method, headers }));

  it("preflight from Sunday is allowed; any other origin isn't", async () => {
    const ok = await raw("OPTIONS", "/api/tasks", {
      origin: "https://sunday.lemydev.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://sunday.lemydev.com");
    expect(ok.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();

    const evil = await raw("OPTIONS", "/api/tasks", { origin: "https://evil.example", "access-control-request-method": "POST" });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("token calls from Sunday's origin get the CORS headers; cookie writes from it are still refused", async () => {
    const s = await sunday(["read", "write"]);
    const r = await raw("GET", "/api/now", { origin: "https://sunday.lemydev.com", authorization: `Bearer ${s.token}` });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://sunday.lemydev.com");
    expect(r.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(r.headers.get("vary")).toContain("Origin");

    const other = await raw("GET", "/api/now", { origin: "https://evil.example", authorization: `Bearer ${s.token}` });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();

    const cookieWrite = await s.user.post("/api/tasks", { title: "x" }, { origin: "https://sunday.lemydev.com" });
    expect(cookieWrite.status).toBe(403);
    expect(cookieWrite.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });
});

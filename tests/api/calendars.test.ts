import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGoogleFetch } from "@/server/calendar/google";
import { setIcalFetch } from "@/server/calendar/ical";
import { resetSyncState, syncCalendars } from "@/server/calendar/sync";
import { closeDb, getDb } from "@/server/db/client";
import { googleCredential } from "@/server/db/schema";
import { now } from "@/server/domain/time";
import { log } from "@/server/log";
import { pushes, resetAll, setNow, setupUser } from "../helpers/api";

const REFRESH = "1//refresh-token-secret";

/** A tiny Google: OAuth token endpoint, revoke, calendarList and events (paginated), with switches for failures. */
const google = {
  calendars: [] as Array<{ id: string; summary: string; primary?: boolean; selected?: boolean; backgroundColor?: string }>,
  events: new Map<string, Array<Record<string, unknown>>>(),
  pageSize: 100,
  invalidGrant: false,
  forbidden: false,
  revoked: [] as string[],
  calls: [] as string[],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeGoogle(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  google.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
  if (u.pathname === "/token") {
    const form = new URLSearchParams(String(init?.body));
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "good-code" || !form.get("code_verifier")) return json(400, { error: "invalid_grant" });
      return json(200, {
        access_token: "ya29.a",
        expires_in: 3600,
        refresh_token: REFRESH,
        scope: "https://www.googleapis.com/auth/calendar.readonly",
      });
    }
    if (google.invalidGrant || form.get("refresh_token") !== REFRESH) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: "ya29.b", expires_in: 3600 });
  }
  if (u.pathname === "/revoke") {
    google.revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
    return json(200, {});
  }
  if (google.invalidGrant) return json(401, { error: { message: "Invalid Credentials" } });
  if (google.forbidden) return json(403, { error: { message: "Forbidden", errors: [{ reason: "forbidden" }] } });
  if (u.pathname.endsWith("/users/me/calendarList")) return json(200, { items: google.calendars });
  const m = /\/calendars\/([^/]+)\/events$/.exec(u.pathname);
  if (m) {
    const all = google.events.get(decodeURIComponent(m[1] ?? "")) ?? [];
    const start = Number(u.searchParams.get("pageToken") ?? 0);
    const page = all.slice(start, start + google.pageSize);
    const next = start + google.pageSize < all.length ? String(start + google.pageSize) : undefined;
    return json(200, { items: page, ...(next ? { nextPageToken: next } : {}) });
  }
  return json(404, { error: { message: "Not Found" } });
}

const timed = (id: string, summary: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "confirmed",
  summary,
  start: { dateTime: start },
  end: { dateTime: end },
  htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
  updated: "2026-11-10T12:00:00Z",
  ...extra,
});

beforeEach(async () => {
  await resetAll("2026-11-16T08:00:00-03:00");
  resetSyncState();
  Object.assign(google, { calendars: [], events: new Map(), pageSize: 100, invalidGrant: false, forbidden: false, revoked: [], calls: [] });
  google.calendars = [
    { id: "lemy@empresa.com", summary: "lemy@empresa.com", primary: true, selected: true, backgroundColor: "#4285f4" },
    { id: "personal@gmail.com", summary: "Personal", selected: true },
    { id: "es.ar#holiday@group.v.calendar.google.com", summary: "Feriados", selected: false },
  ];
  google.events.set("lemy@empresa.com", [timed("daily", "Daily", "2026-11-16T09:30:00-03:00", "2026-11-16T09:45:00-03:00")]);
  google.events.set("personal@gmail.com", [
    { id: "cumple", status: "confirmed", summary: "Cumple", start: { date: "2026-11-18" }, end: { date: "2026-11-19" } },
  ]);
  setGoogleFetch(fakeGoogle);
});
afterEach(() => {
  setGoogleFetch(null);
  setIcalFetch(null);
});
afterAll(() => closeDb());

async function connect() {
  const { user } = await setupUser();
  await user.post("/api/push/subscribe", { endpoint: "https://push.test/phone", keys: { p256dh: "k", auth: "a" } });
  const go = await user.get("/api/google/connect");
  expect(go.status).toBe(302);
  const to = new URL(go.headers.get("location") ?? "");
  expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(to.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly");
  expect(to.searchParams.get("code_challenge_method")).toBe("S256");
  expect(to.searchParams.get("access_type")).toBe("offline");
  const back = await user.get(`/api/google/callback?code=good-code&state=${to.searchParams.get("state")}&scope=x`);
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/ajustes/calendario?google=connected");
  await syncCalendars(getDb(), now(), { force: true });
  return user;
}

const titles = async (user: Awaited<ReturnType<typeof setupUser>>["user"], from = "2026-11-16", to = "2026-11-22") =>
  (await user.get(`/api/events?from=${from}&to=${to}`)).body.events.map((e: { title: string }) => e.title);

describe("Google Calendar", () => {
  it("connects, stores the refresh token encrypted, lists calendars (enabled like in Google) and syncs", async () => {
    const info = vi.spyOn(log, "info");
    const user = await connect();
    const status = (await user.get("/api/calendars")).body;
    expect(status.google).toEqual({ configured: true, connected: true, needsReconnect: false, accountHint: "l…@empresa.com" });
    expect(status.sources.map((s: { name: string; enabled: boolean }) => [s.name, s.enabled])).toEqual([
      ["Feriados", false],
      ["lemy@empresa.com", true],
      ["Personal", true],
    ]);
    const [cred] = await getDb().select().from(googleCredential);
    expect(Buffer.from(cred?.refreshTokenEnc ?? []).toString("latin1")).not.toContain("refresh-token");
    expect(JSON.stringify(status)).not.toContain(REFRESH);
    expect(JSON.stringify(info.mock.calls)).not.toContain(REFRESH);

    const events = (await user.get("/api/events?from=2026-11-16&to=2026-11-22")).body.events;
    expect(events.map((e: { title: string; source: string; readOnly: boolean }) => [e.title, e.source, e.readOnly])).toEqual([
      ["Daily", "google", true],
      ["Cumple", "google", true],
    ]);
    expect(events[0].calendar).toMatchObject({ name: "lemy@empresa.com", color: "#4285f4" });
    // read-only through the API
    const r = await user.patch(`/api/events/${events[0].id}`, { title: "Otra" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("READ_ONLY_EVENT");
    expect((await user.del(`/api/events/${events[0].id}`)).body.error.code).toBe("READ_ONLY_EVENT");
  });

  it("rejects a callback without the matching state cookie", async () => {
    const { user } = await setupUser();
    const back = await user.get("/api/google/callback?code=good-code&state=forged");
    expect(back.headers.get("location")).toBe("/ajustes/calendario?google=state");
    expect((await user.get("/api/calendars")).body.google.connected).toBe(false);
    const denied = await user.get("/api/google/callback?error=admin_policy_enforced");
    expect(denied.headers.get("location")).toBe("/ajustes/calendario?google=admin_policy_enforced");
  });

  it("updates, deletes and cancels; paginates; a 'Recordarme' follows its event", async () => {
    const user = await connect();
    const daily = (await user.get("/api/events?from=2026-11-16&to=2026-11-16")).body.events[0];
    const remind = await user.post(`/api/external-events/${daily.externalEventId}/remind`, { minutesBefore: 10 });
    expect(remind.status).toBe(201);
    expect(remind.body).toMatchObject({
      fireAt: "2026-11-16T09:20:00.000-03:00",
      externalEventId: daily.externalEventId,
      body: "A las 09:30",
    });
    expect((await user.post(`/api/external-events/${daily.externalEventId}/remind`, { minutesBefore: 10 })).status).toBe(409);

    google.pageSize = 1;
    google.events.set("lemy@empresa.com", [
      timed("daily", "Daily (movida)", "2026-11-16T10:00:00-03:00", "2026-11-16T10:15:00-03:00"),
      timed("one", "Uno a uno", "2026-11-17T11:00:00-03:00", "2026-11-17T12:00:00-03:00"),
      timed("two", "Cancelada", "2026-11-17T15:00:00-03:00", "2026-11-17T16:00:00-03:00", { status: "cancelled" }),
    ]);
    google.events.set("personal@gmail.com", []); // the birthday was deleted
    setNow("2026-11-16T08:06:00-03:00");
    await syncCalendars(getDb(), now());
    expect(await titles(user)).toEqual(["Daily (movida)", "Uno a uno"]);
    const r = (await user.get(`/api/reminders/${remind.body.id}`)).body;
    expect(r).toMatchObject({ title: "Daily (movida)", fireAt: "2026-11-16T09:50:00.000-03:00" });
  });

  it("a calendar's automatic reminder (off by default) creates and clears reminders", async () => {
    const user = await connect();
    expect((await user.get("/api/reminders?view=upcoming")).body.reminders).toHaveLength(0);
    const work = (await user.get("/api/calendars")).body.sources.find((s: { name: string }) => s.name === "lemy@empresa.com");
    const patched = await user.patch(`/api/calendars/${work.id}`, { reminderMinutes: 15 });
    expect(patched.body.reminderMinutes).toBe(15);
    let up = (await user.get("/api/reminders?view=upcoming")).body.reminders;
    expect(up.map((x: { title: string; fireAt: string }) => [x.title, x.fireAt])).toEqual([["Daily", "2026-11-16T09:15:00.000-03:00"]]);
    await user.patch(`/api/calendars/${work.id}`, { reminderMinutes: null });
    up = (await user.get("/api/reminders?view=upcoming")).body.reminders;
    expect(up).toHaveLength(0);
    // hiding a calendar hides its events
    await user.patch(`/api/calendars/${work.id}`, { enabled: false });
    expect(await titles(user)).toEqual(["Cumple"]);
  });

  it("invalid_grant → needs reconnect, one push; 403 → error kept on the calendar", async () => {
    const user = await connect();
    google.forbidden = true;
    setNow("2026-11-16T08:06:00-03:00");
    const report = await syncCalendars(getDb(), now());
    expect(report.failed).toBe(2);
    const sources = (await user.get("/api/calendars")).body.sources;
    expect(sources.find((s: { name: string }) => s.name === "Personal").lastError).toMatch(/administrador/);

    google.forbidden = false;
    google.invalidGrant = true;
    resetSyncState();
    const { setGoogleFetch: reset } = await import("@/server/calendar/google");
    reset(fakeGoogle); // drop the cached access token
    setNow("2026-11-16T08:12:00-03:00");
    await syncCalendars(getDb(), now());
    await syncCalendars(getDb(), now().add({ minutes: 6 }));
    expect((await user.get("/api/calendars")).body.google).toMatchObject({ connected: false, needsReconnect: true });
    expect(pushes.filter((p) => p.title === "Google Calendar desconectado")).toHaveLength(1);
    // the events stay visible until Lemy reconnects or disconnects
    expect(await titles(user)).toEqual(["Daily", "Cumple"]);
  });

  it("disconnect revokes at Google and forgets everything", async () => {
    const user = await connect();
    expect((await user.del("/api/google")).status).toBe(204);
    expect(google.revoked).toEqual([REFRESH]);
    const status = (await user.get("/api/calendars")).body;
    expect(status.google.connected).toBe(false);
    expect(status.sources).toEqual([]);
    expect(await titles(user)).toEqual([]);
  });
});

describe("iCal fallback", () => {
  const ics = readFileSync("tests/fixtures/calendar.ics", "utf8");

  it("adds a secret address (validated first), syncs it, never shows it again; removes it", async () => {
    setIcalFetch(async (url) => (url.includes("basic.ics") ? new Response(ics, { status: 200 }) : new Response("nope", { status: 404 })));
    const { user } = await setupUser();
    expect((await user.post("/api/calendars/ical", { name: "Personal", url: "http://example.com/cal.ics" })).status).toBe(400);
    expect((await user.post("/api/calendars/ical", { name: "Personal", url: "https://calendar.google.com/x/other.ics" })).status).toBe(400);
    const url = "webcal://calendar.google.com/calendar/ical/abc%40gmail.com/private-123/basic.ics";
    const added = await user.post("/api/calendars/ical", { name: "Personal", url });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ kind: "ical", name: "Personal", enabled: true });
    expect(JSON.stringify((await user.get("/api/calendars")).body)).not.toContain("private-123");
    expect(await titles(user, "2026-11-16", "2026-11-30")).toEqual(["Gimnasio", "Dentista", "Feriado", "Gimnasio (movido)"]);
    const events = (await user.get("/api/events?from=2026-11-18&to=2026-11-18")).body.events;
    expect(events[0]).toMatchObject({ source: "ical", tentative: true, readOnly: true });
    expect((await user.del(`/api/calendars/${added.body.id}`)).status).toBe(204);
    expect(await titles(user, "2026-11-16", "2026-11-30")).toEqual([]);
  });

  it("an all-day event takes a fixed-time Recordarme", async () => {
    setIcalFetch(async () => new Response(ics, { status: 200 }));
    const { user } = await setupUser();
    await user.post("/api/calendars/ical", { name: "Personal", url: "https://calendar.google.com/x/basic.ics" });
    const feriado = (await user.get("/api/events?from=2026-11-20&to=2026-11-20")).body.events[0];
    expect((await user.post(`/api/external-events/${feriado.id}/remind`, { minutesBefore: 10 })).status).toBe(400);
    const r = await user.post(`/api/external-events/${feriado.id}/remind`, { at: "2026-11-20T09:00:00-03:00" });
    expect(r.body).toMatchObject({ title: "Feriado", body: "Todo el día", fireAt: "2026-11-20T09:00:00.000-03:00" });
  });
});

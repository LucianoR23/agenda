import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { routes } from "@/contract/openapi";
import { closeDb } from "@/server/db/client";
import { handle } from "@/server/api";
import { implementedOperations } from "@/server/http/router";
import { agent, anon, resetAll, setNow, setupUser } from "../helpers/api";
import { D, loadAndChoose } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("platform", () => {
  it("every operation in the contract is implemented", () => {
    expect(implementedOperations().sort()).toEqual(routes.map((r) => r.operationId).sort());
  });

  it("agent rate limit: 120 req/min → 429 with Retry-After", async () => {
    const a = agent();
    for (let i = 0; i < 120; i++) expect((await a.get("/api/habits")).status).toBe(200);
    const r = await a.get("/api/habits");
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("rate_limited");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    setNow("2026-10-19T06:56:01-03:00");
    expect((await a.get("/api/habits")).status).toBe(200);
  });

  it("unknown routes → 404, wrong method → 405 (problem+json)", async () => {
    // straight to the router: these responses are outside the documented paths on purpose
    const nf = await handle(new Request("https://agenda.lemydev.com/api/nope"));
    expect(nf.status).toBe(404);
    expect(nf.headers.get("content-type")).toBe("application/problem+json");
    const na = await handle(new Request("https://agenda.lemydev.com/api/habits", { method: "DELETE" }));
    expect(na.status).toBe(405);
    expect((await na.json()).code).toBe("method_not_allowed");
  });

  it("health checks the DB; openapi.json is compact by default", async () => {
    const h = await anon().get("/api/health");
    expect(h.body).toMatchObject({ status: "ok", db: "ok", version: "test" });
    const compact = await anon().get("/api/openapi.json");
    const full = await anon().get("/api/openapi.json?examples=true");
    expect(compact.body.openapi).toBe("3.1.0");
    expect(JSON.stringify(compact.body)).not.toContain('"examples":{');
    expect(JSON.stringify(full.body).length).toBeGreaterThan(JSON.stringify(compact.body).length * 2);
  });

  it("push subscribe is an upsert by endpoint; unsubscribe", async () => {
    const { user } = await setupUser();
    const sub = { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } };
    const a = await user.post("/api/push/subscribe", sub);
    const b = await user.post("/api/push/subscribe", { ...sub, sleepReminders: false });
    expect(b.body).toMatchObject({ id: a.body.id, callReminders: true, sleepReminders: false });
    expect((await user.del("/api/push/subscribe", { endpoint: sub.endpoint })).status).toBe(204);
  });

  it("export has everything except auth secrets", async () => {
    const { user } = await loadAndChoose();
    const r = await user.get("/api/export");
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="agenda-2026-10-19.json"/);
    expect(r.body.days[0].options).toHaveLength(2);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/pinHash|sessionHash|argon2/);
    expect((await agent().get("/api/export")).status).toBe(403);
  });

  it("changelog: every write is logged with actor and requestId; cursor pagination", async () => {
    await loadAndChoose();
    const page1 = await agent().get("/api/changelog?limit=1");
    expect(page1.body.entries).toHaveLength(1);
    expect(page1.body.entries[0]).toMatchObject({ actor: "user", action: "choose" });
    expect(page1.body.entries[0].requestId).toMatch(/^req_/);
    const page2 = await agent().get(`/api/changelog?limit=5&cursor=${page1.body.nextCursor}`);
    expect(page2.body.entries[0]).toMatchObject({ actor: "agent", action: "create", entity: "day" });
  });

  it("invalid JSON and bad If-Match → 400", async () => {
    await loadAndChoose();
    const bad = await agent().request("PATCH", D, { raw: "{nope" });
    expect(bad.status).toBe(400);
    const im = await agent().patch(D, { notes: "x" }, { "If-Match": "abc" });
    expect(im.status).toBe(400);
  });
});

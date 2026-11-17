import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { routes } from "@/contract/openapi";
import { handle } from "@/server/api";
import { closeDb } from "@/server/db/client";
import { implementedOperations } from "@/server/http/router";
import { anon, resetAll, setupUser } from "../helpers/api";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("platform", () => {
  it("every operation in the contract is implemented", () => {
    expect(implementedOperations().sort()).toEqual(routes.map((r) => r.operationId).sort());
  });

  it("unknown routes → 404, wrong method → 405 (problem+json)", async () => {
    // straight to the router: these responses are outside the documented paths on purpose
    const nf = await handle(new Request("https://agenda.lemydev.com/api/nope"));
    expect(nf.status).toBe(404);
    expect(nf.headers.get("content-type")).toBe("application/json");
    expect((await nf.json()).error.code).toBe("NOT_FOUND");
    const na = await handle(new Request("https://agenda.lemydev.com/api/health", { method: "DELETE" }));
    expect(na.status).toBe(405);
    expect((await na.json()).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("health checks the DB; openapi.json is compact by default", async () => {
    const h = await anon().get("/api/health");
    expect(h.body).toMatchObject({ status: "ok", db: "ok", version: "test" });
    const compact = await anon().get("/api/openapi.json");
    const full = await anon().get("/api/openapi.json?examples=true");
    expect(compact.body.openapi).toBe("3.1.0");
    expect(JSON.stringify(compact.body)).not.toContain('"examples":{');
    expect(JSON.stringify(full.body).length).toBeGreaterThan(JSON.stringify(compact.body).length);
  });

  it("push subscribe is an upsert by endpoint; unsubscribe", async () => {
    const { user } = await setupUser();
    const sub = { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } };
    const a = await user.post("/api/push/subscribe", sub);
    const b = await user.post("/api/push/subscribe", sub);
    expect(b.body).toMatchObject({ id: a.body.id });
    expect((await user.del("/api/push/subscribe", { endpoint: sub.endpoint })).status).toBe(204);
  });
});

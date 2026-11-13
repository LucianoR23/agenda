import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { apiToken, auditEvent } from "@/server/db/schema";
import { anon, client, PIN, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll());
afterAll(() => closeDb());

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function sundayToken(scopes = ["read", "write", "notify"]) {
  const { user } = await setupUser(); // setup = a fresh PIN confirmation
  const r = await user.post("/api/tokens", { name: "sunday", scopes });
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return { user, created: r.body };
}

describe("API tokens", () => {
  it("are shown once, stored hashed, listed without the secret", async () => {
    const { user, created } = await sundayToken();
    expect(created.token).toMatch(/^agd_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 8));
    const [row] = await getDb().select().from(apiToken).where(eq(apiToken.id, created.id));
    expect(row?.tokenHash).not.toContain(created.token);
    const list = await user.get("/api/tokens");
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(created.token);
    const kinds = (await getDb().select().from(auditEvent)).map((e) => e.kind);
    expect(kinds).toContain("token_created");
  });

  it("creating or revoking needs a PIN confirmation within 5 minutes", async () => {
    const { user } = await setupUser();
    setNow("2026-10-19T07:01:00-03:00"); // setup was at 06:55
    const late = await user.post("/api/tokens", { name: "sunday", scopes: ["read"] });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe("REAUTH_REQUIRED");
    expect((await user.post("/api/auth/reauth", { pin: "000000" })).status).toBe(401);
    const ok = await user.post("/api/auth/reauth", { pin: PIN });
    expect(ok.body.validUntil).toBe("2026-10-19T07:06:00.000-03:00");
    const created = await user.post("/api/tokens", { name: "sunday", scopes: ["read"] });
    expect(created.status).toBe(201);
    setNow("2026-10-19T07:07:00-03:00");
    expect((await user.del(`/api/tokens/${created.body.id}`)).status).toBe(403);
    await user.post("/api/auth/reauth", { pin: PIN });
    expect((await user.del(`/api/tokens/${created.body.id}`)).status).toBe(204);
  });

  it("names are unique among active tokens", async () => {
    const { user } = await sundayToken();
    const dup = await user.post("/api/tokens", { name: "sunday", scopes: ["read"] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/Ya hay un token activo llamado "sunday"/);
  });

  it("authenticate by scope; session-only routes are closed to tokens", async () => {
    const { created } = await sundayToken(["read"]);
    const sunday = client("anon");
    const settings = await sunday.get("/api/settings", bearer(created.token));
    expect(settings.status).toBe(200);
    expect(settings.body.timezone).toBe("America/Buenos_Aires");
    const write = await sunday.patch("/api/settings", { timezone: "Europe/Madrid" }, bearer(created.token));
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("FORBIDDEN");
    const devices = await sunday.get("/api/auth/devices", bearer(created.token));
    expect(devices.status).toBe(403);
  });

  it("revoked and expired tokens stop working; last use is tracked once a minute", async () => {
    const { user, created } = await sundayToken();
    const sunday = client("anon");
    await sunday.get("/api/settings", { ...bearer(created.token), "x-forwarded-for": "203.0.113.7" });
    const [used] = await getDb().select().from(apiToken).where(eq(apiToken.id, created.id));
    expect(used?.lastUsedIp).toBe("203.0.113.7");
    await user.del(`/api/tokens/${created.id}`);
    expect((await sunday.get("/api/settings", bearer(created.token))).status).toBe(401);

    const exp = await user.post("/api/tokens", { name: "temporal", scopes: ["read"], expiresAt: "2026-10-19T08:00:00.000-03:00" });
    expect((await sunday.get("/api/settings", bearer(exp.body.token))).status).toBe(200);
    setNow("2026-10-19T08:00:01-03:00");
    expect((await sunday.get("/api/settings", bearer(exp.body.token))).status).toBe(401);
  });

  it("tokens are exempt from the Origin check (no cookies)", async () => {
    const { created } = await sundayToken(["read"]);
    expect((await anon().get("/api/settings", { ...bearer(created.token), origin: "https://sunday.lemydev.com" })).status).toBe(200);
  });
});

describe("settings and timezone", () => {
  it("timezone changes how every timestamp is written; invalid zones are rejected in Spanish", async () => {
    const { user } = await setupUser();
    const bad = await user.patch("/api/settings", { timezone: "Mars/Olympus" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/no es una zona horaria IANA válida/);
    const ok = await user.patch("/api/settings", { timezone: "Europe/Madrid" });
    expect(ok.body.timezone).toBe("Europe/Madrid");
    const session = await user.get("/api/auth/session");
    expect(session.body.timezone).toBe("Europe/Madrid");
    const health = await user.get("/api/health");
    expect(health.body.time).toMatch(/\+02:00$/); // Madrid on 2026-10-19 is still on summer time (CEST)
    expect((await user.patch("/api/settings", { quietStart: null })).status).toBe(400); // both or neither
    expect((await user.patch("/api/settings", { quietStart: null, quietEnd: null })).body.quietStart).toBeNull();
  });
});

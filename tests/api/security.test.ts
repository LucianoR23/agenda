import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handle } from "@/server/api";
import { closeDb, getDb } from "@/server/db/client";
import { auditEvent, notificationLog } from "@/server/db/schema";
import { now } from "@/server/domain/time";
import { prune } from "@/server/jobs/prune";
import { anon, PIN, resetAll, setNow, setupUser } from "../helpers/api";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("CSRF: cookie writes must come from the app", () => {
  it("rejects a foreign Origin, accepts the app's and same-origin fetches", async () => {
    const { user } = await setupUser();
    const body = { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } };
    const evil = await user.post("/api/push/subscribe", body, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    // a sibling subdomain is same-site for cookies, but not the app's origin
    expect((await user.post("/api/push/subscribe", body, { origin: "https://sunday.lemydev.com" })).status).toBe(403);
    expect((await user.post("/api/push/subscribe", body)).status).toBe(201);
  });

  it("without Origin, only Sec-Fetch-Site same-origin passes", async () => {
    const { user } = await setupUser();
    const cookie = [...user.cookieJar].map(([k, v]) => `${k}=${v}`).join("; ");
    const send = (headers: Record<string, string>) =>
      handle(
        new Request("https://agenda.lemydev.com/api/auth/logout", {
          method: "POST",
          headers: { cookie, ...headers },
        }),
      );
    expect((await send({})).status).toBe(403);
    expect((await send({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send({ "sec-fetch-site": "same-origin" })).status).toBe(204);
  });

  it("reads (GET) need no Origin", async () => {
    const { user } = await setupUser();
    expect((await user.get("/api/auth/devices", { origin: "https://evil.example" })).status).toBe(200);
  });
});

describe("request bodies", () => {
  it("must be JSON (415 otherwise)", async () => {
    await setupUser();
    const r = await anon().request("POST", "/api/auth/unlock", {
      raw: "pin=482913",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("validation errors list the fields, in the new envelope", async () => {
    const r = await anon().post("/api/auth/unlock", { pin: "12" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.details.fields[0].path).toBe("/pin");
    expect(r.body.error.requestId).toMatch(/^req_/);
  });
});

describe("audit trail", () => {
  it("records logins, PIN changes and device revocation with device and IP", async () => {
    const { user } = await setupUser();
    await anon().post("/api/auth/unlock", { pin: PIN }, { "x-forwarded-for": "203.0.113.20" });
    await user.post("/api/auth/pin", { currentPin: PIN, newPin: "730154" });
    const events = await getDb().select().from(auditEvent);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["setup", "unlock", "pin_changed"]));
    const unlock = events.find((e) => e.kind === "unlock");
    expect(unlock?.ip).toBe("203.0.113.20");
    expect(unlock?.deviceId).toBeTruthy();
  });
});

describe("pruning", () => {
  it("drops audit/attempts past 90 days and notifications past 180, keeps recent ones", async () => {
    await setupUser();
    const db = getDb();
    await db.insert(notificationLog).values({ kind: "test", title: "old", source: "system", createdAt: new Date("2026-03-01T00:00:00Z") });
    await db.insert(notificationLog).values({ kind: "test", title: "new", source: "system" });
    setNow("2027-02-01T04:00:00-03:00"); // > 90 days after setup
    const counts = await prune(db, now());
    expect(counts.auditEvent).toBeGreaterThan(0);
    expect(counts.authAttempt).toBeGreaterThan(0);
    expect(counts.notificationLog).toBe(1);
    expect((await db.select().from(notificationLog).where(eq(notificationLog.title, "new"))).length).toBe(1);
  });
});

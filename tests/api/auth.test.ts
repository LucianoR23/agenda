import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createResetCode } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { auditEvent, authLockout } from "@/server/db/schema";
import { now } from "@/server/domain/time";
import { anon, client, PIN, pushes, resetAll, setNow, setupUser } from "../helpers/api";
import { SETUP_CODE } from "../helpers/env";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("first-run setup", () => {
  it("requires SETUP_CODE, returns 10 single-use recovery codes, then SETUP_COMPLETED", async () => {
    const c = anon();
    expect((await c.get("/api/auth/session")).body.state).toBe("setup_required");
    const bad = await c.post("/api/auth/setup", { setupCode: "nope", pin: PIN });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject({ code: "INVALID_CREDENTIALS", details: { remainingAttempts: 4 } });
    expect(bad.body.error.message).toMatch(/Te quedan 4 intentos/);
    const ok = await c.post("/api/auth/setup", { setupCode: SETUP_CODE, pin: PIN });
    expect(ok.status).toBe(201);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect(new Set(ok.body.recoveryCodes).size).toBe(10);
    expect(
      ok.cookies.some(
        (k) => k.startsWith("agenda_session=") && k.includes("HttpOnly") && k.includes("Secure") && k.includes("SameSite=Lax"),
      ),
    ).toBe(true);
    expect((await c.get("/api/auth/session")).body.state).toBe("unlocked");
    expect((await anon().post("/api/auth/setup", { setupCode: SETUP_CODE, pin: PIN })).body.error.code).toBe("SETUP_COMPLETED");
  });
});

describe("who can call what", () => {
  it("user (cookie) or nobody; a bad bearer is a 401 even with a cookie", async () => {
    const { user } = await setupUser();
    expect((await anon().get("/api/auth/devices")).status).toBe(401);
    expect((await user.get("/api/auth/devices")).status).toBe(200);
    expect((await client("anon").request("GET", "/api/auth/devices", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await user.request("GET", "/api/auth/devices", { headers: { authorization: "Bearer agd_nope" } })).status).toBe(401);
    expect((await anon().get("/api/health")).status).toBe(200);
    expect((await anon().get("/api/openapi.json")).status).toBe(200);
  });
});

describe("PIN", () => {
  it("5 wrong PINs lock the device for 15 min; the next lockout doubles; success resets", async () => {
    await setupUser();
    const phone = anon();
    await phone.get("/api/auth/session"); // gets a device key
    for (let i = 1; i <= 4; i++) {
      const r = await phone.post("/api/auth/unlock", { pin: "000000" });
      expect(r.status).toBe(401);
      expect(r.body.error.details.remainingAttempts).toBe(5 - i);
    }
    const fifth = await phone.post("/api/auth/unlock", { pin: "000000" });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe("LOCKED_OUT");
    expect(fifth.headers.get("retry-after")).toBe("900");
    expect((await phone.post("/api/auth/unlock", { pin: PIN })).status).toBe(429); // even the right PIN
    expect((await phone.get("/api/auth/session")).body.lockedUntil).toBe("2026-10-19T07:10:00.000-03:00");

    setNow("2026-10-19T07:11:00-03:00");
    for (let i = 0; i < 5; i++) await phone.post("/api/auth/unlock", { pin: "000000" });
    const second = await phone.post("/api/auth/unlock", { pin: PIN });
    expect(second.headers.get("retry-after")).toBe("1800");

    setNow("2026-10-19T07:42:00-03:00");
    expect((await phone.post("/api/auth/unlock", { pin: PIN })).status).toBe(200);
    const rows = await getDb().select().from(authLockout).where(eq(authLockout.scope, "device"));
    expect(rows.every((r) => r.lockedUntil === null && r.failedCount === 0)).toBe(true);
    const kinds = (await getDb().select().from(auditEvent)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "lockout").length).toBeGreaterThanOrEqual(2);
  });

  it("strangers never lock my phone: no global lock, only an alert (once an hour)", async () => {
    const { user } = await setupUser();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/phone", keys: { p256dh: "k", auth: "a" } });
    for (let n = 0; n < 5; n++) {
      const b = anon();
      await b.get("/api/auth/session");
      for (let i = 0; i < 5; i++) await b.post("/api/auth/unlock", { pin: "000000" }, { "x-forwarded-for": `198.51.100.${n}` });
    }
    // 25 failures from 5 browsers/IPs: each is locked, nobody else is
    const phone = anon();
    await phone.get("/api/auth/session");
    expect((await phone.post("/api/auth/unlock", { pin: PIN })).status).toBe(200);
    expect((await user.get("/api/auth/devices")).status).toBe(200);
    const alerts = pushes.filter((p) => p.title === "Intentos de acceso fallidos");
    expect(alerts).toHaveLength(1);
    expect((await getDb().select().from(auditEvent).where(eq(auditEvent.kind, "failed_attempts_alert"))).length).toBe(1);
  });

  it("one IP is locked after 5 failures even from fresh browsers", async () => {
    await setupUser();
    const ip = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 5; i++) {
      const b = anon();
      await b.get("/api/auth/session");
      await b.post("/api/auth/unlock", { pin: "000000" }, ip);
    }
    const fresh = anon();
    await fresh.get("/api/auth/session");
    expect((await fresh.post("/api/auth/unlock", { pin: PIN }, ip)).status).toBe(429);
    // a spoofed first X-Forwarded-For hop doesn't help: Traefik's (last) entry is what counts
    expect((await fresh.post("/api/auth/unlock", { pin: PIN }, { "x-forwarded-for": "1.2.3.4, 203.0.113.9" })).status).toBe(429);
    expect((await fresh.post("/api/auth/unlock", { pin: PIN }, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
  });

  it("a new device logs in with the PIN and appears in Dispositivos; rename and revoke", async () => {
    const { user } = await setupUser();
    const laptop = client("anon");
    const r = await laptop.post("/api/auth/unlock", { pin: PIN, deviceName: "Notebook" });
    expect(r.status).toBe(200);
    const devices = (await user.get("/api/auth/devices")).body.devices;
    expect(devices.map((d: { name: string }) => d.name).sort()).toEqual(["Notebook", "Test phone"]);
    const nb = devices.find((d: { name: string }) => d.name === "Notebook");
    expect((await user.patch(`/api/auth/devices/${nb.id}`, { name: "Notebook del local" })).body.name).toBe("Notebook del local");
    expect((await user.del(`/api/auth/devices/${nb.id}`)).status).toBe(204);
    expect((await laptop.get("/api/auth/devices")).status).toBe(401);
  });

  it("re-auth after 7 days unused; sliding expiry; 90 days → unknown device", async () => {
    const { user } = await setupUser();
    setNow("2026-10-26T06:00:00-03:00"); // 6 days 23 h later
    expect((await user.get("/api/auth/devices")).status).toBe(200);
    setNow("2026-11-02T07:00:00-03:00"); // > 7 days after the last request
    const locked = await user.get("/api/auth/devices");
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe("DEVICE_LOCKED");
    expect((await user.get("/api/auth/session")).body.state).toBe("locked");
    expect((await user.post("/api/auth/unlock", { pin: PIN })).status).toBe(200);
    expect((await user.get("/api/auth/devices")).status).toBe(200);
    expect((await user.get("/api/auth/devices")).body.devices).toHaveLength(1); // same device re-used
    setNow("2027-02-15T07:00:00-03:00");
    expect((await user.get("/api/auth/session")).body.state).toBe("unauthenticated");
  });

  it("change PIN; logout", async () => {
    const { user } = await setupUser();
    expect((await user.post("/api/auth/pin", { currentPin: "111111", newPin: "730154" })).status).toBe(401);
    expect((await user.post("/api/auth/pin", { currentPin: PIN, newPin: "730154" })).status).toBe(204);
    expect((await anon().post("/api/auth/unlock", { pin: "730154" })).status).toBe(200);
    expect((await user.post("/api/auth/logout")).status).toBe(204);
    expect((await user.get("/api/auth/devices")).status).toBe(401);
  });
});

describe("forgot PIN", () => {
  it("recovery code: consumed once, shows remaining count", async () => {
    const { recoveryCodes } = await setupUser();
    const phone = anon();
    const r = await phone.post("/api/auth/recover", {
      method: "recovery_code",
      code: recoveryCodes[3]?.toLowerCase().replaceAll("-", " "),
      newPin: "730154",
    });
    expect(r.status).toBe(200);
    expect(r.body.remainingRecoveryCodes).toBe(9);
    expect((await anon().post("/api/auth/recover", { method: "recovery_code", code: recoveryCodes[3], newPin: "111111" })).status).toBe(
      401,
    );
    expect((await anon().post("/api/auth/unlock", { pin: "730154" })).status).toBe(200);
  });

  it("regenerating recovery codes invalidates the old ones", async () => {
    const { user, recoveryCodes } = await setupUser();
    const regen = await user.post("/api/auth/recovery-codes", { pin: PIN });
    expect(regen.body.recoveryCodes).toHaveLength(10);
    expect((await anon().post("/api/auth/recover", { method: "recovery_code", code: recoveryCodes[0], newPin: "111111" })).status).toBe(
      401,
    );
    expect(
      (await anon().post("/api/auth/recover", { method: "recovery_code", code: regen.body.recoveryCodes[0], newPin: "111111" })).status,
    ).toBe(200);
  });

  it("CLI reset code (pnpm auth:reset-pin): valid 15 min, single use", async () => {
    await setupUser();
    await createResetCode(getDb(), "58302917", now());
    setNow("2026-10-19T07:09:00-03:00");
    expect((await anon().post("/api/auth/recover", { method: "reset_code", code: "58302917", newPin: "730154" })).status).toBe(200);
    expect((await anon().post("/api/auth/recover", { method: "reset_code", code: "58302917", newPin: "730154" })).status).toBe(401);

    await createResetCode(getDb(), "11112222", now());
    setNow("2026-10-19T07:25:00-03:00");
    expect((await anon().post("/api/auth/recover", { method: "reset_code", code: "11112222", newPin: "730154" })).status).toBe(401);
  });
});

describe("fingerprint", () => {
  it("registration options are platform + user verification required; bad verify → 401", async () => {
    const { user } = await setupUser();
    const o = await user.post("/api/auth/passkey/register/options");
    expect(o.status).toBe(200);
    expect(o.body.authenticatorSelection).toMatchObject({ authenticatorAttachment: "platform", userVerification: "required" });
    expect(o.body.rp.id).toBe("agenda.lemydev.com");
    const v = await user.post("/api/auth/passkey/register/verify", { response: { id: "x", rawId: "x", type: "public-key", response: {} } });
    expect(v.status).toBe(401);
    expect((await user.post("/api/auth/passkey/auth/options")).status).toBe(404); // no passkey yet
    expect((await user.del("/api/auth/passkey")).status).toBe(204);
  });
});

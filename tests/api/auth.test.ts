import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createResetCode } from "@/server/auth/auth";
import { getDb, closeDb } from "@/server/db/client";
import { authLockout } from "@/server/db/schema";
import { agent, anon, client, PIN, resetAll, setNow, setupUser } from "../helpers/api";
import { SETUP_CODE } from "../helpers/env";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("first-run setup", () => {
  it("requires SETUP_CODE, returns 10 single-use recovery codes, then 404 forever", async () => {
    const c = anon();
    expect((await c.get("/api/auth/session")).body.state).toBe("setup_required");
    const bad = await c.post("/api/auth/setup", { setupCode: "nope", pin: PIN });
    expect(bad.status).toBe(401);
    expect(bad.body.remainingAttempts).toBe(4);
    const ok = await c.post("/api/auth/setup", { setupCode: SETUP_CODE, pin: PIN });
    expect(ok.status).toBe(201);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect(new Set(ok.body.recoveryCodes).size).toBe(10);
    expect(ok.cookies.some((k) => k.startsWith("agenda_session=") && k.includes("HttpOnly") && k.includes("Secure") && k.includes("SameSite=Lax"))).toBe(true);
    expect((await c.get("/api/auth/session")).body.state).toBe("unlocked");
    expect((await anon().post("/api/auth/setup", { setupCode: SETUP_CODE, pin: PIN })).body.code).toBe("setup_completed");
  });
});

describe("who can call what", () => {
  it("agent (Bearer), user (cookie), none", async () => {
    const { user } = await setupUser();
    expect((await anon().get("/api/habits")).status).toBe(401);
    expect((await agent().get("/api/habits")).status).toBe(200);
    expect((await user.get("/api/habits")).status).toBe(200);
    expect((await client("anon").request("GET", "/api/habits", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await agent().get("/api/auth/devices")).status).toBe(403); // user only
    expect((await user.put("/api/days/2026-10-19", { options: [{ label: "A", title: "x", blocks: [] }] })).status).toBe(403); // agent only
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
      expect(r.body.remainingAttempts).toBe(5 - i);
    }
    const fifth = await phone.post("/api/auth/unlock", { pin: "000000" });
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe("locked_out");
    expect(fifth.headers.get("retry-after")).toBe("900");
    expect((await phone.post("/api/auth/unlock", { pin: PIN })).status).toBe(429); // even the right PIN
    expect((await phone.get("/api/auth/session")).body.lockedUntil).toBe("2026-10-19T07:10:00.000-03:00");

    setNow("2026-10-19T07:11:00-03:00");
    for (let i = 0; i < 5; i++) await phone.post("/api/auth/unlock", { pin: "000000" });
    const second = await phone.post("/api/auth/unlock", { pin: PIN });
    expect(second.headers.get("retry-after")).toBe("1800");

    setNow("2026-10-19T07:42:00-03:00");
    expect((await phone.post("/api/auth/unlock", { pin: PIN })).status).toBe(200);
    const rows = await getDb().select().from(authLockout).where(eq(authLockout.scope, "global"));
    expect(rows[0]).toMatchObject({ failedCount: 0, lockoutCount: 0, lockedUntil: null });
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
    expect((await laptop.get("/api/habits")).status).toBe(401);
  });

  it("re-auth after 7 days unused; sliding expiry; 90 days → unknown device", async () => {
    const { user } = await setupUser();
    setNow("2026-10-26T06:00:00-03:00"); // 6 days 23 h later
    expect((await user.get("/api/habits")).status).toBe(200);
    setNow("2026-11-02T07:00:00-03:00"); // > 7 days after the last request
    const locked = await user.get("/api/habits");
    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe("device_locked");
    expect((await user.get("/api/auth/session")).body.state).toBe("locked");
    expect((await user.post("/api/auth/unlock", { pin: PIN })).status).toBe(200);
    expect((await user.get("/api/habits")).status).toBe(200);
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
    expect((await user.get("/api/habits")).status).toBe(401);
  });
});

describe("forgot PIN", () => {
  it("recovery code: consumed once, shows remaining count", async () => {
    const { recoveryCodes } = await setupUser();
    const phone = anon();
    const r = await phone.post("/api/auth/recover", { method: "recovery_code", code: recoveryCodes[3].toLowerCase().replaceAll("-", " "), newPin: "730154" });
    expect(r.status).toBe(200);
    expect(r.body.remainingRecoveryCodes).toBe(9);
    expect((await anon().post("/api/auth/recover", { method: "recovery_code", code: recoveryCodes[3], newPin: "111111" })).status).toBe(401);
    expect((await anon().post("/api/auth/unlock", { pin: "730154" })).status).toBe(200);
  });

  it("regenerating recovery codes invalidates the old ones", async () => {
    const { user, recoveryCodes } = await setupUser();
    const regen = await user.post("/api/auth/recovery-codes", { pin: PIN });
    expect(regen.body.recoveryCodes).toHaveLength(10);
    expect((await anon().post("/api/auth/recover", { method: "recovery_code", code: recoveryCodes[0], newPin: "111111" })).status).toBe(401);
    expect((await anon().post("/api/auth/recover", { method: "recovery_code", code: regen.body.recoveryCodes[0], newPin: "111111" })).status).toBe(200);
  });

  it("CLI reset code (pnpm auth:reset-pin): valid 15 min, single use", async () => {
    await setupUser();
    await createResetCode(getDb(), "58302917", new Date());
    setNow("2026-10-19T07:09:00-03:00");
    expect((await anon().post("/api/auth/recover", { method: "reset_code", code: "58302917", newPin: "730154" })).status).toBe(200);
    expect((await anon().post("/api/auth/recover", { method: "reset_code", code: "58302917", newPin: "730154" })).status).toBe(401);

    await createResetCode(getDb(), "11112222", new Date());
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

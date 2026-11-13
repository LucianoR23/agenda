import { describe, expect, it } from "vitest";
import { fixedClock } from "@/server/domain/time";
import { contentSecurityPolicy } from "@/server/http/security-headers";
import { dailyAt, every, Scheduler } from "@/server/jobs/scheduler";

const BA = "America/Buenos_Aires";

describe("scheduler", () => {
  it("daily jobs run once per local day, at or after the hour (catching up)", async () => {
    const clock = fixedClock("2026-11-13T06:59:00Z"); // 03:59 in Buenos Aires
    const runs: string[] = [];
    const s = new Scheduler(
      [{ name: "prune", due: dailyAt("04:00"), run: async (now) => runs.push(now.toString()) }],
      clock,
      async () => BA,
    );
    expect(await s.tick()).toEqual([]);
    clock.advance({ minutes: 1 });
    expect(await s.tick()).toEqual(["prune"]);
    clock.advance({ hours: 3 });
    expect(await s.tick()).toEqual([]); // already ran today
    clock.set("2026-11-14T09:30:00Z"); // next day, the 04:00 moment was missed
    expect(await s.tick()).toEqual(["prune"]);
    expect(runs).toHaveLength(2);
  });

  it("interval jobs and failures don't block the others", async () => {
    const clock = fixedClock("2026-11-13T12:00:00Z");
    let ok = 0;
    const s = new Scheduler(
      [
        { name: "boom", due: every(5), run: async () => Promise.reject(new Error("boom")) },
        { name: "ok", due: every(5), run: async () => ok++ },
      ],
      clock,
      async () => BA,
    );
    expect(await s.tick()).toEqual(["ok"]);
    clock.advance({ minutes: 4 });
    expect(await s.tick()).toEqual([]);
    clock.advance({ minutes: 1 });
    expect(await s.tick()).toEqual(["ok"]);
    expect(ok).toBe(2);
  });
});

describe("content security policy", () => {
  it("scripts need the nonce; no eval or inline script in production; framing denied", () => {
    const csp = contentSecurityPolicy("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(contentSecurityPolicy("x", true)).toContain("'unsafe-eval'"); // React dev tooling only
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { DateTimeInput } from "@/contract/common";
import { eventWhen } from "@/server/domain/events";
import { dateText, instantText, localInstant, splitDue } from "@/server/domain/time";
import type { ApiError } from "@/server/http/errors";
import { limitToken, resetRateLimits, TOKEN_LIMITS } from "@/server/http/ratelimit";

const BA = "America/Buenos_Aires";
const I = (s: string) => Temporal.Instant.from(s);

describe("whenText", () => {
  it("weekday, day and month in Spanish; the year only when it's another one", () => {
    expect(dateText("2026-11-14", 2026)).toBe("sábado 14 de noviembre");
    expect(dateText("2027-01-03", 2026)).toBe("domingo 3 de enero de 2027");
    expect(instantText(I("2026-11-19T12:05:00Z"), BA, 2026)).toBe("jueves 19 de noviembre, 09:05");
  });

  it("events: same-day range, overnight, all-day and multi-day", () => {
    const at = (s: string) => I(s);
    expect(
      eventWhen(
        { allDay: false, startsAt: at("2026-11-18T13:00:00Z"), endsAt: at("2026-11-18T14:30:00Z"), startDate: null, endDate: null },
        BA,
      ),
    ).toMatch(/^miércoles 18 de noviembre(?: de 2026)?, 10:00–11:30$/);
    expect(
      eventWhen(
        { allDay: false, startsAt: at("2026-11-21T01:00:00Z"), endsAt: at("2026-11-21T05:00:00Z"), startDate: null, endDate: null },
        BA,
      ),
    ).toMatch(/^viernes 20 de noviembre(?: de 2026)?, 22:00 → sábado 21 de noviembre(?: de 2026)?, 02:00$/);
    expect(eventWhen({ allDay: true, startsAt: null, endsAt: null, startDate: "2026-11-20", endDate: "2026-11-21" }, BA)).toMatch(
      /^viernes 20 de noviembre(?: de 2026)? \(todo el día\)$/,
    );
    expect(eventWhen({ allDay: true, startsAt: null, endsAt: null, startDate: "2026-11-20", endDate: "2026-11-23" }, BA)).toMatch(
      /^del viernes 20 de noviembre(?: de 2026)? al domingo 22 de noviembre(?: de 2026)? \(todo el día\)$/,
    );
  });
});

describe("forgiving date-times", () => {
  it("without offset = the user's wall time; with offset = that instant", () => {
    expect(localInstant("2026-11-14T09:00", BA).toString()).toBe("2026-11-14T12:00:00Z");
    expect(localInstant("2026-11-14T09:00:30", BA).toString()).toBe("2026-11-14T12:00:30Z");
    expect(localInstant("2026-11-14T09:00:00Z", BA).toString()).toBe("2026-11-14T09:00:00Z");
    expect(localInstant("2026-11-14T09:00:00+01:00", BA).toString()).toBe("2026-11-14T08:00:00Z");
  });

  it("a due date-time splits into local date and time", () => {
    expect(splitDue("2026-11-14", BA)).toEqual({ date: "2026-11-14", time: null });
    expect(splitDue("2026-11-14T23:30", BA)).toEqual({ date: "2026-11-14", time: "23:30" });
    expect(splitDue("2026-11-15T01:30:00Z", BA)).toEqual({ date: "2026-11-14", time: "22:30" });
  });

  it("the contract accepts ISO date-times with or without offset, nothing else", () => {
    for (const ok of ["2026-11-14T09:00", "2026-11-14T09:00:00", "2026-11-14T09:00:00.000-03:00", "2026-11-14T12:00:00Z"])
      expect(DateTimeInput.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["2026-11-14", "mañana 9", "2026-11-14 09:00", "2026-13-40T09:00"])
      expect(DateTimeInput.safeParse(bad).success, bad).toBe(false);
  });
});

describe("token rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("a minute window and a day window", () => {
    const t0 = Date.UTC(2026, 10, 14, 12);
    const status = (ms: number) => {
      try {
        limitToken("t", ms);
        return 200;
      } catch (e) {
        return (e as ApiError).status;
      }
    };
    let now = t0;
    let ok = 0;
    // spread over the day at the per-minute limit until the daily cap
    while (ok < TOKEN_LIMITS.perDay) {
      for (let i = 0; i < TOKEN_LIMITS.perMinute && ok < TOKEN_LIMITS.perDay; i++) {
        expect(status(now)).toBe(200);
        ok++;
      }
      now += 61_000;
    }
    expect(status(now)).toBe(429);
    expect(status(t0 + 86_400_000 + 1)).toBe(200);
  });
});

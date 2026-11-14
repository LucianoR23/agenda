import { describe, expect, it } from "vitest";
import { effectiveDue, inQuietHours } from "@/server/domain/quiet-hours";
import { nextReminderFire } from "@/server/domain/recurrence";

const BA = "America/Buenos_Aires";
const at = (iso: string) => Temporal.Instant.from(iso);
const local = (i: Temporal.Instant | null | undefined) =>
  i?.toZonedDateTimeISO(BA).toString({ timeZoneName: "never", smallestUnit: "minute" });

describe("quiet hours", () => {
  const night = { start: "23:30", end: "07:00" };
  it("windows can cross midnight", () => {
    expect(inQuietHours("23:45", night)).toBe(true);
    expect(inQuietHours("03:00", night)).toBe(true);
    expect(inQuietHours("07:00", night)).toBe(false);
    expect(inQuietHours("12:00", night)).toBe(false);
    expect(inQuietHours("14:00", { start: "13:00", end: "15:00" })).toBe(true);
    expect(inQuietHours("14:00", { start: null, end: null })).toBe(false);
  });

  it("a reminder inside the window waits for its end (same night); urgent ones don't", () => {
    expect(local(effectiveDue(at("2026-11-16T23:45:00-03:00"), BA, night, false))).toBe("2026-11-17T07:00-03:00");
    expect(local(effectiveDue(at("2026-11-17T01:00:00-03:00"), BA, night, false))).toBe("2026-11-17T07:00-03:00");
    expect(local(effectiveDue(at("2026-11-17T09:00:00-03:00"), BA, night, false))).toBe("2026-11-17T09:00-03:00");
    expect(local(effectiveDue(at("2026-11-16T23:45:00-03:00"), BA, night, true))).toBe("2026-11-16T23:45-03:00");
  });
});

describe("recurring reminders", () => {
  it("daily across a month end, skipping missed occurrences", () => {
    const n = nextReminderFire("FREQ=DAILY", at("2026-11-30T08:00:00-03:00"), BA, at("2026-11-30T08:00:05-03:00"));
    expect(local(n?.fireAt)).toBe("2026-12-01T08:00-03:00");
    const late = nextReminderFire("FREQ=DAILY", at("2026-11-27T08:00:00-03:00"), BA, at("2026-11-30T12:00:00-03:00"));
    expect(local(late?.fireAt)).toBe("2026-12-01T08:00-03:00");
  });

  it("weekly and COUNT", () => {
    const w = nextReminderFire("FREQ=WEEKLY;BYDAY=MO,TH", at("2026-11-16T09:00:00-03:00"), BA, at("2026-11-16T09:00:01-03:00"));
    expect(local(w?.fireAt)).toBe("2026-11-19T09:00-03:00");
    const a = nextReminderFire("FREQ=DAILY;COUNT=2", at("2026-11-16T09:00:00-03:00"), BA, at("2026-11-16T09:00:01-03:00"));
    expect(a?.rrule).toBe("FREQ=DAILY;COUNT=1");
    expect(nextReminderFire(a!.rrule, a!.fireAt, BA, a!.fireAt.add({ seconds: 1 }))).toBeNull();
  });

  it("keeps local time across a DST change (Madrid)", () => {
    const n = nextReminderFire("FREQ=DAILY", at("2026-10-24T09:00:00+02:00"), "Europe/Madrid", at("2026-10-24T09:00:01+02:00"));
    expect(n?.fireAt.toZonedDateTimeISO("Europe/Madrid").toString({ timeZoneName: "never", smallestUnit: "minute" })).toBe(
      "2026-10-25T09:00+01:00",
    );
  });
});

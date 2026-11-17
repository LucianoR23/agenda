import { describe, expect, it } from "vitest";
import { nextOccurrence, normalizeTaskRrule } from "@/server/domain/recurrence";

const BA = "America/Buenos_Aires";

describe("task recurrence", () => {
  it("next occurrence after an on-time completion", () => {
    expect(nextOccurrence("FREQ=DAILY", "2026-11-13", null, BA, "2026-11-13")?.dueDate).toBe("2026-11-14");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-11-16", "08:30", BA, "2026-11-16")?.dueDate).toBe("2026-11-23");
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=31", "2026-10-31", null, BA, "2026-10-31")?.dueDate).toBe("2026-12-31");
    expect(nextOccurrence("FREQ=YEARLY", "2026-12-15", null, BA, "2026-12-15")?.dueDate).toBe("2027-12-15");
  });

  it("an overdue completion skips the missed occurrences and counts for today", () => {
    // daily, due Friday 13, completed Monday 16 → Tuesday 17
    expect(nextOccurrence("FREQ=DAILY", "2026-11-13", null, BA, "2026-11-16")?.dueDate).toBe("2026-11-17");
    // every Monday, due Monday 9, completed Thursday 12 → Monday 16
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-11-09", null, BA, "2026-11-12")?.dueDate).toBe("2026-11-16");
    // completed early: due Wednesday 18, done Monday 16 → Thursday 19
    expect(nextOccurrence("FREQ=DAILY", "2026-11-18", null, BA, "2026-11-16")?.dueDate).toBe("2026-11-19");
  });

  it("COUNT ends the series, counting missed occurrences as used", () => {
    const a = nextOccurrence("FREQ=DAILY;COUNT=3", "2026-11-13", null, BA, "2026-11-13");
    expect(a).toEqual({ dueDate: "2026-11-14", rrule: "FREQ=DAILY;COUNT=2" });
    const b = nextOccurrence(a!.rrule, a!.dueDate, null, BA, "2026-11-14");
    expect(b).toEqual({ dueDate: "2026-11-15", rrule: "FREQ=DAILY;COUNT=1" });
    expect(nextOccurrence(b!.rrule, b!.dueDate, null, BA, "2026-11-15")).toBeNull();
    // 4 times from the 13th (13, 14, 15, 16), completed on the 14th: the 14th counts as done today → the 15th, 2 left
    expect(nextOccurrence("FREQ=DAILY;COUNT=4", "2026-11-13", null, BA, "2026-11-14")).toEqual({
      dueDate: "2026-11-15",
      rrule: "FREQ=DAILY;COUNT=2",
    });
    // 3 times from the 13th, completed on the 15th (the last one) → series over
    expect(nextOccurrence("FREQ=DAILY;COUNT=3", "2026-11-13", null, BA, "2026-11-15")).toBeNull();
  });

  it("UNTIL ends the series", () => {
    expect(nextOccurrence("FREQ=DAILY;UNTIL=20261114T235959Z", "2026-11-14", null, BA, "2026-11-14")).toBeNull();
  });

  it("normalizes and validates", () => {
    expect(normalizeTaskRrule("rrule:freq=weekly;byday=mo,we", "2026-11-16", null, BA)).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(() => normalizeTaskRrule("FREQ=HOURLY", "2026-11-16", null, BA)).toThrow(/diaria, semanal, mensual o anual/);
    expect(() => normalizeTaskRrule("DTSTART:20261116\nRRULE:FREQ=DAILY", "2026-11-16", null, BA)).toThrow(/DTSTART/);
    expect(() => normalizeTaskRrule("FREQ=WEEKLY;BYDAY=XX", "2026-11-16", null, BA)).toThrow(/No entendí/);
  });
});

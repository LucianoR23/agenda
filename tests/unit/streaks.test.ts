import { describe, expect, it } from "vitest";
import { periodsInRange, streaks } from "@/server/domain/streaks";

describe("streaks", () => {
  const weekly = { kind: "boolean" as const, targetCount: 3, targetPeriod: "week" as const };
  const daily = { kind: "numeric" as const, targetCount: 20, targetPeriod: "day" as const };
  const gym = (dates: string[]) => dates.map((date) => ({ date, done: true, value: null }));

  it("weekly: counts met weeks back from the current one; the running week doesn't break it", () => {
    // weeks of 09-28, 10-05 met (3 each); week of 10-12 met; current week (10-19) only 1 so far
    const logs = gym([
      "2026-09-28",
      "2026-09-30",
      "2026-10-02",
      "2026-10-05",
      "2026-10-07",
      "2026-10-09",
      "2026-10-12",
      "2026-10-14",
      "2026-10-16",
      "2026-10-19",
    ]);
    expect(streaks(weekly, logs, "2026-10-19")).toEqual({ current: 3, best: 3 });
  });

  it("daily numeric: needs value ≥ target; a missed past day breaks", () => {
    const logs = [
      { date: "2026-10-16", done: true, value: 25 },
      { date: "2026-10-17", done: true, value: 10 },
      { date: "2026-10-18", done: true, value: 30 },
      { date: "2026-10-19", done: true, value: 22 },
    ];
    expect(streaks(daily, logs, "2026-10-19")).toEqual({ current: 2, best: 2 });
    expect(periodsInRange(daily, logs, "2026-10-16", "2026-10-19", "2026-10-19")).toEqual({ met: 3, total: 4 });
  });
});

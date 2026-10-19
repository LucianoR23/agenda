import { describe, expect, it } from "vitest";
import { planMerge } from "@/server/domain/merge";
import { planBlockPatch } from "@/server/domain/ownership";
import type { BlockRow } from "@/server/domain/rows";
import { periodsInRange, streaks } from "@/server/domain/streaks";
import { addDays, instantAt, isoLocal, localDate, localTime, monthEnd, sleepNightFor, weekStart } from "@/server/time";
import { blockRange, blockTime } from "@/ui/format";

const NOW = new Date("2026-10-19T12:00:00-03:00");

const row = (o: Partial<BlockRow>): BlockRow => ({
  id: o.id ?? "b1",
  optionId: "o1",
  dayId: "d1",
  start: "10:00",
  end: "10:45",
  title: "Llamada de cierre",
  type: "call",
  detail: null,
  lead: null,
  source: "calendar",
  externalId: "ev1",
  externalUrl: null,
  calendar: "work",
  removedFromCalendarAt: null,
  status: "pending",
  statusAt: null,
  outcome: null,
  note: null,
  locked: false,
  remind: true,
  userOverrides: [],
  order: 0,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
  updatedBy: "agent",
  ...o,
});

describe("planMerge", () => {
  it("matches calendar blocks by externalId and moves them", () => {
    const p = planMerge([row({})], [{ source: "calendar", externalId: "ev1", start: "15:00", end: "15:45", title: "Llamada de cierre", type: "call", calendar: "work" }], NOW);
    expect(p.inserts).toHaveLength(0);
    expect(p.updates[0].set).toMatchObject({ start: "15:00", end: "15:45" });
    expect(p.diff.moved[0].from.start).toBe("10:00");
  });

  it("matches agent blocks by id and preserves my overridden fields", () => {
    const reading = row({ id: "r1", source: "agent", externalId: null, type: "reading", title: "Lectura", start: "11:15", end: "11:45", userOverrides: ["start", "end"] });
    const p = planMerge([reading], [{ id: "r1", source: "agent", start: "14:00", end: "14:30", title: "Lectura larga", type: "reading" }], NOW);
    expect(p.updates[0].set).toEqual({ title: "Lectura larga" });
    expect(p.diff.preservedOverrides[0].fields).toEqual(["start", "end"]);
  });

  it("never touches tracking fields; locked blocks keep their schedule", () => {
    const done = row({ status: "done", outcome: "follow_up", note: "x", locked: true });
    const p = planMerge([done], [{ source: "calendar", externalId: "ev1", start: "16:00", end: "16:45", title: "Otro", type: "call", calendar: "work" }], NOW);
    expect(p.updates).toHaveLength(0);
    expect(p.diff.preservedOverrides[0].fields).toEqual(["start", "end", "title"]);
  });

  it("keeps a tracked calendar block that disappeared (removedFromCalendarAt), deletes untouched ones", () => {
    const tracked = row({ id: "t", externalId: "gone1", status: "done", outcome: "no_show" });
    const untouched = row({ id: "u", externalId: "gone2" });
    const p = planMerge([tracked, untouched], [], NOW);
    expect(p.updates).toEqual([{ before: tracked, set: { removedFromCalendarAt: NOW } }]);
    expect(p.deletes.map((b) => b.id)).toEqual(["u"]);
    expect(p.diff.keptRemovedFromCalendar[0].id).toBe("t");
  });

  it("clears removedFromCalendarAt when the event comes back", () => {
    const back = row({ removedFromCalendarAt: NOW, status: "done" });
    const p = planMerge([back], [{ source: "calendar", externalId: "ev1", start: "10:00", end: "10:45", title: "Llamada de cierre", type: "call", calendar: "work" }], NOW);
    expect(p.updates[0].set).toEqual({ removedFromCalendarAt: null });
  });

  it("agent blocks without a known id fall back to type + title (no duplicates on re-send)", () => {
    const reading = row({ id: "r1", source: "agent", externalId: null, type: "reading", title: "Lectura", start: "11:00", end: "11:30", status: "done" });
    const p = planMerge([reading], [{ id: "019a0a6e-0000-7000-8000-000000000999", source: "agent", start: "14:00", end: "14:30", title: "Lectura", type: "reading" }], NOW);
    expect(p.inserts).toHaveLength(0);
    expect(p.updates[0]).toMatchObject({ before: { id: "r1" }, set: { start: "14:00", end: "14:30" } });
  });

  it("never deletes my own blocks or locked blocks", () => {
    const mine = row({ id: "m", source: "user", externalId: null, type: "other" });
    const locked = row({ id: "l", source: "agent", externalId: null, type: "gym", locked: true });
    expect(planMerge([mine, locked], [], NOW).deletes).toHaveLength(0);
  });
});

describe("planBlockPatch (ownership)", () => {
  const cal = row({});
  const agentBlock = row({ id: "a", source: "agent", externalId: null, type: "reading", title: "Lectura", start: "11:00", end: "11:30" });

  it("calendar schedule fields are owned by Google for me", () => {
    expect(planBlockPatch(cal, { start: "10:30" }, "user", NOW)).toEqual({ kind: "calendar_owned", fields: ["start"] });
  });

  it("my schedule edit joins userOverrides; tracking sets statusAt", () => {
    const p = planBlockPatch(agentBlock, { start: "11:15", status: "done" }, "user", NOW);
    expect(p).toMatchObject({ set: { start: "11:15", status: "done", statusAt: NOW, userOverrides: ["start"] }, scheduleChanged: ["start"] });
  });

  it("agent vs my overrides → conflict, unless force (which drops the override)", () => {
    const edited = { ...agentBlock, userOverrides: ["start" as const] };
    expect(planBlockPatch(edited, { start: "14:00" }, "agent", NOW)).toMatchObject({ kind: "user_edit_conflict", reason: "overrides" });
    expect(planBlockPatch(edited, { start: "14:00", force: true }, "agent", NOW)).toMatchObject({ forced: true, set: { start: "14:00", userOverrides: [] } });
  });

  it("locked blocks reject the agent even with force", () => {
    expect(planBlockPatch({ ...agentBlock, locked: true }, { start: "14:00", force: true }, "agent", NOW)).toMatchObject({ kind: "user_edit_conflict", reason: "locked" });
  });

  it("agent sets tracking only while unset / pending", () => {
    expect(planBlockPatch(agentBlock, { status: "done" }, "agent", NOW)).toMatchObject({ set: { status: "done" } });
    expect(planBlockPatch({ ...agentBlock, status: "skipped" }, { status: "done" }, "agent", NOW)).toMatchObject({ kind: "user_edit_conflict", reason: "tracking" });
    expect(planBlockPatch({ ...cal, outcome: "follow_up" }, { outcome: "closed_won" }, "agent", NOW)).toMatchObject({ kind: "user_edit_conflict" });
    expect(planBlockPatch(cal, { remind: false }, "agent", NOW)).toEqual({ kind: "forbidden", fields: ["remind"] });
  });

  it("same value is a no-op, not a conflict", () => {
    expect(planBlockPatch({ ...agentBlock, userOverrides: ["start"] }, { start: "11:00" }, "agent", NOW)).toEqual({ set: {}, scheduleChanged: [], forced: false });
  });

  it("outcome only on calls", () => {
    expect(planBlockPatch(agentBlock, { outcome: "lost" }, "user", NOW)).toMatchObject({ kind: "invalid" });
  });
});

describe("streaks", () => {
  const weekly = { kind: "boolean" as const, targetCount: 3, targetPeriod: "week" as const };
  const daily = { kind: "numeric" as const, targetCount: 20, targetPeriod: "day" as const };
  const gym = (dates: string[]) => dates.map((date) => ({ date, done: true, value: null }));

  it("weekly: counts met weeks back from the current one; the running week doesn't break it", () => {
    // weeks of 09-28, 10-05 met (3 each); week of 10-12 met; current week (10-19) only 1 so far
    const logs = gym(["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19"]);
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

describe("ART time (UTC-3) and midnight edges", () => {
  it("23:59 ART is still the same local day; 00:00 ART is the next one", () => {
    expect(localDate(new Date("2026-10-20T02:59:00Z"))).toBe("2026-10-19");
    expect(localDate(new Date("2026-10-20T03:00:00Z"))).toBe("2026-10-20");
    expect(localTime(new Date("2026-10-20T03:05:00Z"))).toBe("00:05");
  });

  it("formats with -03:00 and maps block times past midnight", () => {
    expect(isoLocal(new Date("2026-10-19T10:00:04.812Z"))).toBe("2026-10-19T07:00:04.812-03:00");
    expect(instantAt("2026-10-19", "24:15").toISOString()).toBe("2026-10-20T03:15:00.000Z");
    expect(blockTime("24:15")).toEqual({ text: "00:15", nextDay: true });
    expect(blockRange("23:30", "07:00")).toBe("23:30–07:00 (+1)");
    expect(blockRange("24:15", "07:45")).toBe("00:15 (+1)–07:45");
  });

  it("sleep night: before 12:00 belongs to the previous day", () => {
    expect(sleepNightFor(new Date("2026-10-20T00:20:00-03:00"))).toBe("2026-10-19");
    expect(sleepNightFor(new Date("2026-10-19T23:40:00-03:00"))).toBe("2026-10-19");
    expect(sleepNightFor(new Date("2026-10-20T11:59:00-03:00"))).toBe("2026-10-19");
  });

  it("weeks start on Monday; month ends", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { agent, type Client, resetAll, setNow, setupUser } from "../helpers/api";

/**
 * Fixture week Mon 12 – Fri 16 Oct 2026, option A each day:
 *   dogs 07:00 (agent) · calls (calendar) · gym 18:00 · reading 21:00
 * calls/day 2,1,3,2,1 with outcomes closed_won, follow_up | no_show | follow_up, rescheduled, closed_won | lost, follow_up | (none)
 * gym done Mon/Wed/Fri, skipped Tue/Thu · reading done Tue–Fri · dogs done Mon/Fri, skipped Tue–Thu
 * habits: gym weekly 3 (linked to gym blocks), reading daily (linked to reading blocks)
 * sleep: 12th 23:50→07:00 (430), 13th 00:30→07:10 (400), 14th bed 23:40 only · review on the 15th · undone task on the 16th
 */
const DAYS = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const CALLS: Array<Array<string | null>> = [["closed_won", "follow_up"], ["no_show"], ["follow_up", "rescheduled", "closed_won"], ["lost", "follow_up"], [null]];
const GYM = ["done", "skipped", "done", "skipped", "done"];
const READING = ["pending", "done", "done", "done", "done"];
const DOGS = ["done", "skipped", "skipped", "skipped", "done"];

let user: Client;

async function loadDay(i: number) {
  const date = DAYS[i];
  setNow(`${date}T07:00:00-03:00`);
  const blocks = [
    { source: "agent" as const, start: "07:00", end: "07:30", type: "dogs" as const, title: "Paseo con las perras" },
    ...CALLS[i].map((_, k) => ({ source: "calendar" as const, externalId: `c-${date}-${k}`, calendar: "work" as const, start: `${10 + k}:00`, end: `${10 + k}:45`, type: "call" as const, title: "Llamada", lead: { name: `Lead ${k}` } })),
    { source: "agent" as const, start: "18:00", end: "19:00", type: "gym" as const, title: "Gym" },
    { source: "agent" as const, start: "21:00", end: "21:30", type: "reading" as const, title: "Lectura" },
  ];
  await agent().put(`/api/days/${date}`, { options: [{ label: "A", title: "Plan", blocks }], ...(i === 4 ? { tasks: [{ title: "Seguimiento a Diego", kind: "follow_up" }] } : {}) });
  const day = (await user.post(`/api/days/${date}/choose`, { option: "A" })).body;
  setNow(`${date}T22:00:00-03:00`);
  const by = (t: string) => day.options[0].blocks.filter((b: { type: string }) => b.type === t);
  for (const [k, c] of by("call").entries()) {
    const outcome = CALLS[i][k];
    if (outcome) await user.patch(`/api/days/${date}/blocks/${c.id}`, { status: "done", outcome });
  }
  const set = async (t: string, status: string) => {
    if (status !== "pending") await user.patch(`/api/days/${date}/blocks/${by(t)[0].id}`, { status });
  };
  await set("gym", GYM[i]);
  await set("reading", READING[i]);
  await set("dogs", DOGS[i]);
  if (i === 3) await user.patch(`/api/days/${date}`, { review: { energy: 4, mood: 3 } });
}

beforeAll(async () => {
  await resetAll("2026-10-12T06:00:00-03:00");
  user = (await setupUser()).user;
  await user.post("/api/habits", { slug: "gym", name: "Gym", kind: "boolean", targetCount: 3, targetPeriod: "week", blockType: "gym" });
  await user.post("/api/habits", { slug: "reading", name: "Lectura", kind: "boolean", targetCount: 1, targetPeriod: "day", blockType: "reading" });
  for (let i = 0; i < DAYS.length; i++) await loadDay(i);
  setNow("2026-10-17T08:00:00-03:00");
  await user.put("/api/sleep/2026-10-12", { bedAt: "2026-10-12T23:50:00-03:00", wokeAt: "2026-10-13T07:00:00-03:00" });
  await user.put("/api/sleep/2026-10-13", { bedAt: "2026-10-14T00:30:00-03:00", wokeAt: "2026-10-14T07:10:00-03:00" });
  await user.put("/api/sleep/2026-10-14", { bedAt: "2026-10-14T23:40:00-03:00" });
}, 120_000);
afterAll(() => closeDb());

describe("agent context (Saturday 17, 08:00)", () => {
  it("weekly gym, pending habits, streaks at risk, yesterday, last review, skipped patterns", async () => {
    setNow("2026-10-17T08:00:00-03:00");
    const r = await agent().get("/api/agent/context");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      date: "2026-10-17",
      weekStart: "2026-10-12",
      weeklyGym: { done: 3, target: 3, source: "habit" },
      habitsPendingToday: [{ slug: "reading", periodCount: 0, periodTarget: 1, targetPeriod: "day" }],
      streaksAtRisk: [{ slug: "reading", currentStreak: 4, reason: "not_done_today", remainingInPeriod: 1 }],
      yesterday: { date: "2026-10-16", status: "closed", completion: 0.75, blocksDone: 3, blocksTotal: 4 },
      lastReview: { date: "2026-10-15", energy: 4, mood: 3, text: null },
      lastNightSleep: null,
      skippedPatterns: [{ type: "dogs", hour: "07:00", skipped: 3, total: 5 }],
      pendingProposal: null,
    });
    expect(r.body.yesterday.unfinishedTasks.map((t: { title: string }) => t.title)).toEqual(["Seguimiento a Diego"]);
  });
});

describe("metrics (week of the 12th, seen on Monday 19)", () => {
  it("blocks, calls, gym, reading, sleep and habit streaks", async () => {
    setNow("2026-10-19T08:00:00-03:00");
    const r = await user.get("/api/metrics?range=week&anchor=2026-10-14");
    expect(r.status).toBe(200);
    const m = r.body;
    expect(m).toMatchObject({ range: "week", from: "2026-10-12", to: "2026-10-18" });
    expect(m.blocks).toEqual({
      total: 24,
      done: 17,
      skipped: 5,
      pending: 2,
      doneRate: 0.71,
      byType: [
        { type: "call", total: 9, done: 8, skipped: 0, doneRate: 0.89 },
        { type: "dogs", total: 5, done: 2, skipped: 3, doneRate: 0.4 },
        { type: "gym", total: 5, done: 3, skipped: 2, doneRate: 0.6 },
        { type: "reading", total: 5, done: 4, skipped: 0, doneRate: 0.8 },
      ],
    });
    expect(m.calls).toEqual({
      total: 9,
      perDay: [2, 1, 3, 2, 1, 0, 0].map((count, i) => ({ date: `2026-10-${12 + i}`, count })),
      outcomes: { closed_won: 2, follow_up: 3, no_show: 1, rescheduled: 1, lost: 1, unset: 1 },
      showUpRate: 0.86, // 6 showed / 7 (8 with outcome − 1 rescheduled)
      closeRate: 0.33, // 2 / 6
    });
    expect(m.gym).toEqual({ habitSlug: "gym", weeks: [{ weekStart: "2026-10-12", count: 3, target: 3 }], total: 3 });
    expect(m.reading).toEqual({ habitSlug: "reading", days: 4, totalDays: 7 });
    expect(m.sleep).toMatchObject({ nightsLogged: 2, nightsTotal: 7, avgDurationMinutes: 415, avgBedtime: "24:00", avgWakeTime: "07:05", avgBedDelayMinutes: null });
    expect(m.habits).toEqual([
      { slug: "gym", name: "Gym", currentStreak: 1, bestStreak: 1, periodsMet: 1, periodsTotal: 1 },
      { slug: "reading", name: "Lectura", currentStreak: 0, bestStreak: 4, periodsMet: 4, periodsTotal: 7 },
    ]);
  });

  it("month and year ranges", async () => {
    setNow("2026-10-19T08:00:00-03:00");
    const month = (await user.get("/api/metrics?range=month&anchor=2026-10-14")).body;
    expect(month).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(month.calls.perDay).toHaveLength(19); // only up to today
    expect(month.blocks.total).toBe(24);
    const year = (await user.get("/api/metrics?range=year")).body;
    expect(year).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
  });
});

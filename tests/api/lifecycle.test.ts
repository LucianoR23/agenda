import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as ex from "@/contract/examples";
import { closeDb } from "@/server/db/client";
import { agent, internal, resetAll, setNow } from "../helpers/api";
import { blockOf, byExt, byType, D, DATE, loadAndChoose, MARTIN } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("closing days", () => {
  it("close-day cron at 00:05 closes yesterday, supersedes its proposal, purges old idempotency keys; idempotent", async () => {
    await loadAndChoose();
    await agent().put(D, ex.dayInputReplan, { "Idempotency-Key": "old" });
    setNow("2026-10-21T08:00:00-03:00"); // > 48 h after the key (cron missed at 00:05 on the 20th)
    const r = await internal().post("/api/internal/close-day", {});
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ closed: [DATE], purgedIdempotencyKeys: 1 });
    expect((await internal().post("/api/internal/close-day", {})).body.closed).toEqual([]);
    const day = (await agent().get(D)).body;
    expect(day.status).toBe("closed");
    expect(day.closedAt).toBe("2026-10-21T08:00:00.000-03:00");
    expect(day.pendingProposal).toBeNull();
  });

  it("close-day requires X-Internal-Token", async () => {
    expect((await agent().post("/api/internal/close-day", {})).status).toBe(401);
  });

  it("lazy close: a missed cron never breaks history (first read closes the past day)", async () => {
    await loadAndChoose();
    setNow("2026-10-20T09:00:00-03:00");
    const r = await agent().get(D);
    expect(r.body.status).toBe("closed");
    const log = await agent().get(`/api/changelog?from=${DATE}&to=${DATE}&actor=system`);
    expect(log.body.entries[0]).toMatchObject({ action: "close", actor: "system" });
  });

  it("closed day: the agent gets day_closed; I can still edit (corrections, review)", async () => {
    const { user, day } = await loadAndChoose();
    setNow("2026-10-20T09:00:00-03:00");
    const martin = blockOf(day, byExt(MARTIN));
    expect((await agent().put(D, ex.dayInputReplan)).body.code).toBe("day_closed");
    expect((await agent().patch(`${D}/blocks/${martin.id}`, { status: "done" })).body.code).toBe("day_closed");
    expect((await agent().patch(D, { callsSummary: "x" })).body.code).toBe("day_closed");
    expect((await agent().post("/api/tasks", { date: DATE, title: "tarde" })).body.code).toBe("day_closed");
    const mine = await user.patch(`${D}/blocks/${martin.id}`, { status: "done", outcome: "closed_won" });
    expect(mine.status).toBe(200);
    expect((await user.patch(D, { review: { energy: 4, mood: 5 } })).body.review).toEqual({ energy: 4, mood: 5, text: null });
  });

  it("I can close the day early; the agent cannot", async () => {
    const { user } = await loadAndChoose();
    expect((await agent().patch(D, { status: "closed" })).status).toBe(403);
    const r = await user.patch(D, { status: "closed", review: { energy: 3, mood: 3, text: "Cansado" } });
    expect(r.body).toMatchObject({ status: "closed", review: { energy: 3, mood: 3, text: "Cansado" } });
  });

  it("the agent can't fill my review once set", async () => {
    const { user } = await loadAndChoose();
    expect((await agent().patch(D, { review: { energy: 2, mood: 2 } })).status).toBe(200);
    await user.patch(D, { review: { energy: 4, mood: 4 } });
    expect((await agent().patch(D, { review: { energy: 1, mood: 1 } })).body.code).toBe("user_edit_conflict");
  });
});

describe("midnight in Buenos Aires", () => {
  it("23:59 ART is still today: no lazy close, the agent can write", async () => {
    const { day } = await loadAndChoose();
    setNow("2026-10-19T23:59:59-03:00");
    const gym = blockOf(day, byType("gym"));
    expect((await agent().patch(`${D}/blocks/${gym.id}`, { status: "done" })).status).toBe(200);
    expect((await agent().get(D)).body.status).toBe("chosen");
  });

  it("00:00 ART (03:00 UTC) is the next day: the past day closes", async () => {
    await loadAndChoose();
    setNow("2026-10-20T03:00:00Z");
    expect((await agent().get(D)).body.status).toBe("closed");
  });

  it("an agent PUT for a past date that never existed → day_closed", async () => {
    expect((await agent().put("/api/days/2026-10-18", ex.dayInput0700)).body.code).toBe("day_closed");
  });

  it("history: day summaries with completion, closing past days on the way", async () => {
    const { user, day } = await loadAndChoose();
    await user.patch(`${D}/blocks/${blockOf(day, byType("gym")).id}`, { status: "done" });
    await user.patch(`${D}/blocks/${blockOf(day, byType("dogs")).id}`, { status: "skipped" });
    setNow("2026-10-20T08:00:00-03:00");
    const r = await user.get("/api/days?from=2026-10-18&to=2026-10-20");
    expect(r.body.days).toEqual([
      expect.objectContaining({ date: DATE, status: "closed", chosenOption: "A", blocksTotal: 12, blocksDone: 1, blocksSkipped: 1, completion: 0.08, callsTotal: 2 }),
    ]);
    expect((await user.get("/api/days?from=2026-10-20&to=2026-10-18")).status).toBe(400);
  });
});

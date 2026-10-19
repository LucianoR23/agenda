import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as ex from "@/contract/examples";
import { closeDb } from "@/server/db/client";
import { agent, anon, resetAll, setNow, setupUser } from "../helpers/api";

const D = "/api/days/2026-10-19";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("07:00 load and choose", () => {
  it("creates a draft day with both options, calendar + agent blocks and the checklist", async () => {
    const r = await agent().put(D, ex.dayInput0700, { "Idempotency-Key": "load-1" });
    expect(r.status).toBe(201);
    expect(r.body.result).toBe("created");
    const day = r.body.day;
    expect(day.status).toBe("draft");
    expect(day.options.map((o: { label: string }) => o.label)).toEqual(["A", "B"]);
    expect(day.options[0].blocks).toHaveLength(12);
    expect(day.tasks).toHaveLength(4);
    expect(day.tasks[0].relatedBlockId).toBe(day.options[0].blocks.find((b: { externalId: string }) => b.externalId === "4f2k9q0d1m7b8s6t3u1v0a2c3e").id);
    expect(r.headers.get("etag")).toBe(`"${day.version}"`);
    const calls = day.options[0].blocks.filter((b: { type: string }) => b.type === "call");
    expect(calls.every((b: { remind: boolean }) => b.remind)).toBe(true);
  });

  it("the agent's GET and my GET return the same day; anonymous gets 401", async () => {
    await agent().put(D, ex.dayInput0700);
    const { user } = await setupUser();
    const a = await agent().get(D);
    const u = await user.get(D);
    expect(a.status).toBe(200);
    expect(u.body).toEqual(a.body);
    expect((await anon().get(D)).status).toBe(401);
  });

  it("returns 404 day_not_found before the agent loads it", async () => {
    const r = await agent().get("/api/days/2026-10-20");
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("day_not_found");
  });

  it("I choose option A → chosen", async () => {
    await agent().put(D, ex.dayInput0700);
    const { user } = await setupUser();
    setNow("2026-10-19T07:42:00-03:00");
    const r = await user.post(`${D}/choose`, { option: "A" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("chosen");
    expect(r.body.chosenOption).toBe("A");
  });
});

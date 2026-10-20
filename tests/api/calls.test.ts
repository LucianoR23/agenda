import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { agent, resetAll, setNow } from "../helpers/api";
import { blockOf, byExt, D, LAURA, loadAndChoose, MARTIN } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("closer vs triage calls (D93)", () => {
  it("the agent's calendar mirror carries the kind; it shows on every block", async () => {
    const { day } = await loadAndChoose();
    expect(blockOf(day, byExt(MARTIN)).callKind).toBe("closer");
    expect(blockOf(day, byExt(LAURA)).callKind).toBe("triage");
    expect(blockOf(day, (b) => b.type === "gym").callKind).toBeNull();
  });

  it("outcomes are restricted by kind; a closer can turn out not qualified", async () => {
    const { user, day } = await loadAndChoose();
    setNow("2026-10-19T15:00:00-03:00");
    const martin = `${D}/blocks/${blockOf(day, byExt(MARTIN)).id}`;
    const laura = `${D}/blocks/${blockOf(day, byExt(LAURA)).id}`;

    const wrong = await user.patch(laura, { status: "done", outcome: "closed_won" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.errors).toEqual([{ path: "/outcome", message: "closed_won is not an outcome of a triage call" }]);
    expect((await user.patch(martin, { outcome: "qualified" })).status).toBe(422);

    expect((await user.patch(laura, { status: "done", outcome: "qualified" })).body).toMatchObject({ outcome: "qualified", callKind: "triage" });
    expect((await user.patch(martin, { status: "done", outcome: "not_qualified" })).body).toMatchObject({ outcome: "not_qualified", callKind: "closer" });
  });

  it("the kind of a calendar call is Google's; my own calls take any kind and clear it when they stop being calls", async () => {
    const { user, day } = await loadAndChoose();
    const laura = blockOf(day, byExt(LAURA));
    expect((await user.patch(`${D}/blocks/${laura.id}`, { callKind: "closer" })).body.code).toBe("calendar_owned");

    const mine = await user.post(D + "/blocks", { start: "18:00", end: "18:30", title: "Llamada con Sofi", type: "call", callKind: "triage" });
    expect(mine.body).toMatchObject({ callKind: "triage", userOverrides: expect.arrayContaining(["callKind"]) });
    const url = `${D}/blocks/${mine.body.id}`;
    await user.patch(url, { outcome: "qualified" });
    // changing the kind under an outcome it can't have
    const clash = await user.patch(url, { callKind: "closer" });
    expect(clash.status).toBe(422);
    expect(clash.body.errors[0].path).toBe("/callKind");
    expect((await user.patch(url, { callKind: "closer", outcome: "follow_up" })).body).toMatchObject({ callKind: "closer", outcome: "follow_up" });

    const other = await user.post(D + "/blocks", { start: "19:00", title: "Llamar a mamá", type: "call", callKind: "closer" });
    expect((await user.patch(`${D}/blocks/${other.body.id}`, { type: "other" })).body).toMatchObject({ type: "other", callKind: null });
  });

  it("callKind only on calls; the agent mirrors a kind change to every copy of the event", async () => {
    const { user } = await loadAndChoose();
    const bad = await user.post(D + "/blocks", { start: "18:00", title: "Gym", type: "gym", callKind: "closer" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([{ path: "/callKind", message: "Only call blocks have a callKind" }]);

    const r = await agent().patch(`${D}/blocks/by-external/${LAURA}`, { callKind: "closer" });
    expect(r.status).toBe(200);
    expect(r.body.blocks.map((b: { callKind: string }) => b.callKind)).toEqual(["closer", "closer"]); // every copy
  });
});

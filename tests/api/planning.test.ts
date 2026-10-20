import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as ex from "@/contract/examples";
import { closeDb } from "@/server/db/client";
import { agent, pushes, resetAll, setNow, setupUser } from "../helpers/api";
import { blockOf, byExt, byTitle, byType, D, DATE, LAURA, load, loadAndChoose, MARTIN, opt, replan } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

describe("PUT /days/{date}: validation and idempotency", () => {
  it("rejects bad bodies with field paths (problem+json)", async () => {
    const r = await agent().put(D, { options: [{ label: "A", title: "Plan", blocks: [{ source: "calendar", start: "9:30", title: "Llamada", type: "call" }] }] });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    expect(r.body.code).toBe("validation_error");
    expect(r.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["/options/0/blocks/0/externalId", "/options/0/blocks/0/start"]);
    expect(r.body.requestId).toMatch(/^req_/);
  });

  it("rejects unknown fields (strict)", async () => {
    const r = await agent().put(D, { ...ex.dayInput0700, mood: "great" });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].message).toMatch(/Unrecognized key/);
  });

  it("is idempotent: same key + same body replays; same key + other body → 422", async () => {
    const a = agent();
    const first = await a.put(D, ex.dayInput0700, { "Idempotency-Key": "k1" });
    const again = await a.put(D, ex.dayInput0700, { "Idempotency-Key": "k1" });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body).toEqual(first.body);
    const other = await a.put(D, { ...ex.dayInput0700, notes: "otra cosa" }, { "Idempotency-Key": "k1" });
    expect(other.status).toBe(422);
    expect(other.body.code).toBe("idempotency_key_reuse");
  });

  it("re-sending the same day without a key is a no-op replace (draft stays the same)", async () => {
    const first = await load();
    const r = await agent().put(D, ex.dayInput0700);
    expect(r.status).toBe(200);
    expect(r.body.result).toBe("replaced");
    expect(opt(r.body.day).blocks.map((b: { id: string }) => b.id).sort()).toEqual(opt(first).blocks.map((b) => b.id).sort());
  });

  it("draft replace keeps my tracking on matched blocks and never duplicates them", async () => {
    await load();
    const { user } = await setupUser();
    const day = (await user.get(D)).body;
    const dogs = blockOf(day, byType("dogs"));
    expect((await user.patch(`${D}/blocks/${dogs.id}`, { status: "done" })).status).toBe(200);
    const moved = { ...ex.dayInput0700, options: [{ ...ex.dayInput0700.options[0], blocks: ex.dayInput0700.options[0].blocks.map((b) => (b.type === "dogs" ? { ...b, start: "07:30", end: "08:00" } : b)) }, ex.dayInput0700.options[1]] };
    const r = await agent().put(D, moved);
    const all = opt(r.body.day).blocks.filter((b: { type: string }) => b.type === "dogs");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: dogs.id, status: "done", start: "07:30" });
  });
});

describe("version conflicts", () => {
  it("If-Match with a stale version → 409 version_conflict with the current resource", async () => {
    const { user, day } = await loadAndChoose();
    const reading = blockOf(day, byTitle("Lectura (30 min)"));
    const r = await user.patch(`${D}/blocks/${reading.id}`, { start: "11:15" }, { "If-Match": '"7"' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("version_conflict");
    expect(r.body.current.id).toBe(reading.id);
    const ok = await user.patch(`${D}/blocks/${reading.id}`, { start: "11:15", version: reading.version as number });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe((reading.version as number) + 1);
  });

  it("day PATCH with body version", async () => {
    const { user, day } = await loadAndChoose();
    expect((await user.patch(D, { notes: "x", version: day.version - 1 })).body.code).toBe("version_conflict");
    expect((await user.patch(D, { notes: "x", version: day.version })).status).toBe(200);
  });
});

describe("ownership", () => {
  it("calendar blocks: I can't move them (calendar_owned) but I track them", async () => {
    const { user, day } = await loadAndChoose();
    const martin = blockOf(day, byExt(MARTIN));
    const move = await user.patch(`${D}/blocks/${martin.id}`, { start: "10:30" });
    expect(move.status).toBe(409);
    expect(move.body.code).toBe("calendar_owned");
    const done = await user.patch(`${D}/blocks/${martin.id}`, { status: "done", outcome: "follow_up", note: "Llamar jueves" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done", outcome: "follow_up" });
    expect(done.body.statusAt).toBe("2026-10-19T07:42:00.000-03:00");
    expect((await user.del(`${D}/blocks/${martin.id}`)).body.code).toBe("calendar_owned");
  });

  it("my edits become userOverrides; the agent can't overwrite them unless force (logged)", async () => {
    const { user, day } = await loadAndChoose();
    const reading = blockOf(day, byTitle("Lectura (30 min)"));
    const mine = await user.patch(`${D}/blocks/${reading.id}`, { start: "11:15", end: "11:45" });
    expect(mine.body.userOverrides).toEqual(["start", "end"]);
    expect((await user.get(D)).body.status).toBe("edited");

    const clash = await agent().patch(`${D}/blocks/${reading.id}`, { start: "14:00" });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("user_edit_conflict");
    expect(clash.body.current.start).toBe("11:15");

    const title = await agent().patch(`${D}/blocks/${reading.id}`, { title: "Lectura: Hábitos atómicos" });
    expect(title.status).toBe(200);

    const forced = await agent().patch(`${D}/blocks/${reading.id}`, { start: "14:00", force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.start).toBe("14:00");
    expect(forced.body.userOverrides).toEqual(["end"]);
    const log = await agent().get(`/api/changelog?from=${DATE}&to=${DATE}&actor=agent`);
    expect(log.body.entries.some((e: { forced: boolean }) => e.forced)).toBe(true);
  });

  it("locked blocks: the agent can't touch them, not even with force", async () => {
    const { user, day } = await loadAndChoose();
    const gym = blockOf(day, byType("gym"));
    await user.patch(`${D}/blocks/${gym.id}`, { locked: true });
    const r = await agent().patch(`${D}/blocks/${gym.id}`, { start: "18:00", force: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("user_edit_conflict");
    expect((await agent().patch(`${D}/blocks/${gym.id}`, { locked: false })).status).toBe(403);
  });

  it("tracking fields: the agent sets them while pending, never over mine", async () => {
    const { user, day } = await loadAndChoose();
    const gym = blockOf(day, byType("gym"));
    const byAgent = await agent().patch(`${D}/blocks/${gym.id}`, { status: "done" });
    expect(byAgent.status).toBe(200);
    expect(byAgent.body.updatedBy).toBe("agent");

    const martin = blockOf(day, byExt(MARTIN));
    await user.patch(`${D}/blocks/${martin.id}`, { status: "done", outcome: "follow_up" });
    const r = await agent().patch(`${D}/blocks/${martin.id}`, { outcome: "closed_won" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("user_edit_conflict");
  });

  it("by-external mirrors a Google change into every copy (draft: A and B)", async () => {
    await load();
    const r = await agent().patch(`${D}/blocks/by-external/${LAURA}`, { start: "15:00", end: "15:45" });
    expect(r.status).toBe(200);
    expect(r.body.blocks).toHaveLength(2);
    expect(r.body.blocks.every((b: { start: string }) => b.start === "15:00")).toBe(true);
    expect((await agent().patch(`${D}/blocks/by-external/nope`, { start: "15:00" })).status).toBe(404);
  });

  it("my blocks: created as mine (all overrides), agent can't delete; reorder is mine", async () => {
    const { user, day } = await loadAndChoose();
    const c = await user.post(`${D}/blocks`, { start: "09:50", end: "10:00", title: "Pagar alquiler", type: "other" });
    expect(c.status).toBe(201);
    expect(c.body.source).toBe("user");
    expect(c.body.userOverrides).toHaveLength(8);
    expect((await agent().del(`${D}/blocks/${c.body.id}`)).body.code).toBe("user_edit_conflict");
    expect((await user.post(`${D}/blocks`, { start: "09:50", title: "Evento", type: "meeting", source: "calendar", externalId: "x" })).status).toBe(403);

    const breakfast = blockOf(day, byTitle("Desayuno"));
    const dogs = blockOf(day, byType("dogs"));
    const r = await user.post(`${D}/blocks/reorder`, { ids: [breakfast.id, dogs.id] });
    expect(r.status).toBe(200);
    expect(r.body.blocks.map((b: { order: number }) => b.order)).toEqual([0, 1]);
    expect((await user.post(`${D}/blocks/reorder`, { ids: [blockOf(day, byExt(MARTIN)).id] })).body.code).toBe("calendar_owned");
    expect((await user.del(`${D}/blocks/${c.body.id}`)).status).toBe(204);
  });

  it("Armar mi día: my own day is chosen; the agent's load becomes a proposal", async () => {
    const { user } = await setupUser();
    const r = await user.post("/api/days/2026-10-20", {});
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "chosen", chosenOption: "A" });
    expect(r.body.options[0].title).toBe("Mi día");
    expect((await user.post("/api/days/2026-10-20", {})).status).toBe(409);
    const put = await agent().put("/api/days/2026-10-20", ex.dayInput0700);
    expect(put.status).toBe(202);
    expect(put.body.result).toBe("proposed");
  });
});

describe("proposals", () => {
  it("chosen/edited day → 202 proposal; supersede; accept preserves tracking and overrides", async () => {
    const { user, day } = await loadAndChoose();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } });
    const martin = blockOf(day, byExt(MARTIN));
    const reading = blockOf(day, byTitle("Lectura (30 min)"));
    setNow("2026-10-19T10:48:00-03:00");
    await user.patch(`${D}/blocks/${martin.id}`, { status: "done", outcome: "follow_up" });
    await user.patch(`${D}/blocks/${reading.id}`, { start: "11:15", end: "11:45" });

    setNow("2026-10-19T12:20:00-03:00");
    const first = await agent().put(D, replan({ reason: "primera" }));
    expect(first.status).toBe(202);
    setNow("2026-10-19T12:30:00-03:00");
    const withIds = replan();
    withIds.options = [{ ...withIds.options[0], blocks: withIds.options[0].blocks.map((b) => (b.title === "Lectura (30 min)" ? { ...b, id: reading.id } : b)) }];
    const second = await agent().put(D, withIds);
    expect(second.status).toBe(202);
    expect(pushes.map((p) => p.title)).toContain("Agenbot propone un cambio");

    // day unchanged until I accept
    const before = (await user.get(D)).body;
    expect(blockOf(before, byExt(LAURA)).start).toBe("14:00");
    expect(before.pendingProposal.id).toBe(second.body.proposal.id);
    const diff = before.pendingProposal.diff;
    expect(diff.moved.map((m: { block: { title: string } }) => m.block.title)).toEqual(["Primera llamada"]);
    expect(diff.preservedOverrides[0].fields).toEqual(["start", "end"]);

    const list = (await user.get(`${D}/proposals`)).body.proposals;
    expect(list.map((p: { status: string }) => p.status)).toEqual(["pending", "superseded"]);
    expect((await user.post(`${D}/proposals/${first.body.proposal.id}/accept`)).body.code).toBe("invalid_transition");
    expect((await agent().post(`${D}/proposals/${second.body.proposal.id}/accept`)).status).toBe(403);

    setNow("2026-10-19T12:41:00-03:00");
    const acc = await user.post(`${D}/proposals/${second.body.proposal.id}/accept`);
    expect(acc.status).toBe(200);
    expect(blockOf(acc.body, byExt(LAURA)).start).toBe("15:00");
    expect(blockOf(acc.body, byTitle("Lectura (30 min)")).start).toBe("11:15");
    expect(blockOf(acc.body, byExt(MARTIN))).toMatchObject({ status: "done", outcome: "follow_up" });
    expect(acc.body.pendingProposal).toBeNull();
    expect(opt(acc.body, "B").blocks.length).toBeGreaterThan(0); // omitted options are kept
  });

  it("reject leaves the day untouched; ?mode=force applies immediately with preservation", async () => {
    const { user, day } = await loadAndChoose();
    const martin = blockOf(day, byExt(MARTIN));
    await user.patch(`${D}/blocks/${martin.id}`, { status: "done" });
    const p = await agent().put(D, replan());
    const rej = await user.post(`${D}/proposals/${p.body.proposal.id}/reject`);
    expect(rej.body.status).toBe("rejected");
    expect(blockOf((await user.get(D)).body, byExt(LAURA)).start).toBe("14:00");

    const f = await agent().put(`${D}?mode=force`, replan());
    expect(f.status).toBe(200);
    expect(blockOf(f.body.day, byExt(LAURA)).start).toBe("15:00");
    expect(blockOf(f.body.day, byExt(MARTIN)).status).toBe("done");
  });

  it("a re-plan on a chosen day must include the chosen option", async () => {
    await loadAndChoose("B");
    const r = await agent().put(D, replan());
    expect(r.status).toBe(422);
  });

  it("tasks in a proposal PUT apply immediately (Q6)", async () => {
    await loadAndChoose();
    const r = await agent().put(D, replan({ tasks: [{ title: "Confirmar a Laura (15:00)", kind: "whatsapp_confirm", relatedExternalId: LAURA }] }));
    expect(r.status).toBe(202);
    const tasks = (await agent().get(`/api/tasks?date=${DATE}`)).body.tasks;
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Confirmar a Laura (15:00)"]);
  });

  it("a calendar event that disappears is kept if I tracked it, removed otherwise", async () => {
    const { user, day } = await loadAndChoose();
    const laura = blockOf(day, byExt(LAURA));
    await user.patch(`${D}/blocks/${laura.id}`, { status: "done", outcome: "no_show" });
    const body = replan();
    body.options = [{ ...body.options[0], blocks: body.options[0].blocks.filter((b) => b.externalId !== LAURA && b.externalId !== "9b8c7d6e5f4g3h2i1j0k9l8m7n") }];
    const f = await agent().put(`${D}?mode=force`, body);
    const after = f.body.day;
    expect(blockOf(after, byExt(LAURA))).toMatchObject({ status: "done", outcome: "no_show" });
    expect(blockOf(after, byExt(LAURA)).removedFromCalendarAt).not.toBeNull();
    expect(blockOf(after, byType("padel"))).toBeUndefined();
  });
});

describe("choose and shift", () => {
  it("choose: switch while chosen, not once edited; agent may choose (Q7)", async () => {
    const { user, day } = await loadAndChoose();
    expect((await user.post(`${D}/choose`, { option: "Z" })).status).toBe(404);
    expect((await user.post(`${D}/choose`, { option: "B" })).body.chosenOption).toBe("B");
    expect((await agent().post(`${D}/choose`, { option: "A" })).body.updatedBy).toBe("agent");
    await user.patch(`${D}/blocks/${blockOf(day, byTitle("Lectura (30 min)")).id}`, { start: "11:10" });
    expect((await user.post(`${D}/choose`, { option: "B" })).body.code).toBe("invalid_transition");
  });

  it("Me atrasé +45 at night moves pareja and sleep past midnight; calendar stays; recorded as shift", async () => {
    const { user } = await loadAndChoose();
    setNow("2026-10-19T21:20:00-03:00");
    const r = await user.post(`${D}/shift`, { fromTime: "21:00", minutes: 45 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("edited");
    expect(blockOf(r.body, byType("partner"))).toMatchObject({ start: "22:30", end: "23:30" });
    expect(blockOf(r.body, byType("sleep"))).toMatchObject({ start: "24:15", end: "07:45", userOverrides: ["start", "end"] });
    expect(blockOf(r.body, byType("padel")).start).toBe("20:30");
    const log = await user.get(`/api/changelog?from=${DATE}&to=${DATE}`);
    const shift = log.body.entries.find((e: { action: string }) => e.action === "shift");
    expect(shift.diff.after.blocks).toHaveLength(2);
  });

  it("shift: draft → invalid_transition; out of 00:00–29:59 → 422", async () => {
    await load();
    const { user } = await setupUser();
    expect((await user.post(`${D}/shift`, { fromTime: "11:00", minutes: 30 })).body.code).toBe("invalid_transition");
    await user.post(`${D}/choose`, { option: "A" });
    await user.post(`${D}/blocks`, { start: "01:00", end: "01:30", title: "Algo temprano", type: "other" });
    const r = await user.post(`${D}/shift`, { fromTime: "00:30", minutes: -120 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("shift_out_of_range");
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdjustmentWebhookPayload } from "@/contract/adjustments";
import { WebhookPayload } from "@/contract/tracking";
import { closeDb, getDb } from "@/server/db/client";
import { webhookOutbox } from "@/server/db/schema";
import { deliverDueWebhooks } from "@/server/jobs";
import { agent, pushes, resetAll, setNow, setupUser } from "../helpers/api";
import { blockOf, byTitle, D, DATE, load, loadAndChoose, replan } from "../helpers/fixtures";

beforeEach(() => resetAll());
afterAll(() => closeDb());

const A = "/api/adjustments";
type Sent = { headers: Record<string, string>; body: Record<string, unknown> & { changes?: Array<Record<string, unknown>> } };

function fakeFetch(statuses: number[] = []) {
  const sent: Sent[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    sent.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, sent };
}
const outbox = () => getDb().select().from(webhookOutbox);

/** Chosen day, the choose webhook already delivered, and one request sent at 12:20. */
async function chosenWithRequest(text = "Laura pasó a las 15:00 y me surgió algo de 17 a 18.") {
  const { user, day } = await loadAndChoose();
  await user.post("/api/push/subscribe", { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } });
  await deliverDueWebhooks(new Date("2026-10-19T07:43:00-03:00"), fakeFetch().fn);
  setNow("2026-10-19T12:20:00-03:00");
  const r = await user.post(A, { date: DATE, text });
  expect(r.status).toBe(201);
  return { user, day, adj: r.body };
}

describe("Pedir ajuste", () => {
  it("creating a request sends adjustment.requested right away, alone, not batched with my changes", async () => {
    const { user, day, adj } = await chosenWithRequest();
    expect(adj).toMatchObject({ date: DATE, status: "pending", agentNote: null, proposal: null, resolvedAt: null, version: 1, updatedBy: "user" });

    // a normal change right after goes to the debounced day batch, not into the request's event
    await user.patch(`${D}/blocks/${blockOf(day, byTitle("Lectura (30 min)")).id}`, { start: "11:15", end: "11:45" });

    const f = fakeFetch();
    expect(await deliverDueWebhooks(new Date("2026-10-19T12:20:00-03:00"), f.fn)).toBe(1); // no debounce
    expect(f.sent[0].body).toEqual({
      event: "adjustment.requested",
      adjustmentId: adj.id,
      date: DATE,
      text: adj.text,
      createdAt: adj.createdAt,
      adjustmentUrl: `https://agenda.lemydev.com/api/adjustments/${adj.id}`,
      dayUrl: `https://agenda.lemydev.com/api/days/${DATE}`,
    });
    expect(AdjustmentWebhookPayload.safeParse(f.sent[0].body).success).toBe(true);
    expect(f.sent[0].headers).toMatchObject({ Authorization: "Bearer webhook-token" });

    expect(await deliverDueWebhooks(new Date("2026-10-19T12:22:01-03:00"), f.fn)).toBe(1); // the debounced batch
    expect(f.sent[1].body).toMatchObject({ event: "day.updated_by_user", changes: [expect.objectContaining({ entity: "block" })] });
  });

  it("past or closed days → 409 day_closed; a day not loaded yet is fine", async () => {
    const { user } = await setupUser();
    setNow("2026-10-19T12:00:00-03:00");
    expect((await user.post(A, { date: "2026-10-18", text: "x" })).body.code).toBe("day_closed");
    expect((await user.post(A, { date: "2026-10-20", text: "Mañana entro a las 10" })).status).toBe(201);

    await load();
    setNow("2026-10-19T20:00:00-03:00");
    await user.patch(D, { status: "closed" });
    expect((await user.post(A, { date: DATE, text: "x" })).status).toBe(409);
    expect((await user.post(A, { date: DATE, text: "   " })).status).toBe(400);
  });

  it("agent answers with a proposal (adjustmentIds) → proposed; done waits for me; accepting resolves it", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();
    expect((await ag.get(`${A}?date=${DATE}&status=pending`)).body.adjustments.map((a: { id: string }) => a.id)).toEqual([adj.id]);

    setNow("2026-10-19T12:30:00-03:00");
    const put = await ag.put(D, replan({ adjustmentIds: [adj.id] }));
    expect(put.status).toBe(202);
    const proposalId = put.body.proposal.id;
    expect(pushes.at(-1)).toMatchObject({ title: "Tu ajuste está listo" });

    const proposed = (await ag.get(`${A}/${adj.id}`)).body;
    expect(proposed).toMatchObject({ status: "proposed", proposal: { id: proposalId, status: "pending" }, resolvedAt: null, updatedBy: "agent" });

    setNow("2026-10-19T12:31:00-03:00");
    const done = await ag.patch(`${A}/${adj.id}`, { status: "done", agentNote: "Moví a Laura a las 15:00." }, { "If-Match": `"${proposed.version}"` });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done", agentNote: "Moví a Laura a las 15:00.", resolvedAt: null });
    expect(done.headers.get("etag")).toBe(`"${done.body.version}"`);

    setNow("2026-10-19T12:41:00-03:00");
    expect((await user.post(`${D}/proposals/${proposalId}/accept`)).status).toBe(200);
    const after = (await user.get(`${A}/${adj.id}`)).body;
    expect(after).toMatchObject({ status: "done", proposal: { id: proposalId, status: "accepted" }, resolvedAt: "2026-10-19T12:41:00.000-03:00" });

    // the immediate accept change tells Agenbot which requests it answered
    const f = fakeFetch();
    await deliverDueWebhooks(new Date("2026-10-19T12:41:00-03:00"), f.fn);
    const accept = f.sent.find((s) => s.body.event === "day.updated_by_user")!;
    expect(WebhookPayload.safeParse(accept.body).success).toBe(true);
    expect(accept.body.changes).toEqual([expect.objectContaining({ entity: "proposal", action: "accept", adjustmentIds: [adj.id] })]);
  });

  it("rejecting the linked proposal also resolves the request", async () => {
    const { user, adj } = await chosenWithRequest();
    const put = await agent().put(D, replan({ adjustmentIds: [adj.id] }));
    await user.post(`${D}/proposals/${put.body.proposal.id}/reject`);
    expect((await user.get(`${A}/${adj.id}`)).body).toMatchObject({ status: "proposed", proposal: { status: "rejected" }, resolvedAt: expect.any(String) });
  });

  it("transitions: cancel only while pending; resolved requests → 409 adjustment_resolved", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();

    setNow("2026-10-19T12:25:00-03:00");
    const cancelled = await user.post(`${A}/${adj.id}/cancel`);
    expect(cancelled.body).toMatchObject({ status: "cancelled", resolvedAt: "2026-10-19T12:25:00.000-03:00" });
    const f = fakeFetch();
    await deliverDueWebhooks(new Date("2026-10-19T12:25:00-03:00"), f.fn);
    expect(f.sent.map((s) => s.body.event)).toEqual(["adjustment.requested", "adjustment.cancelled"]);
    expect(f.sent[1].body).toMatchObject({ adjustmentId: adj.id, cancelledAt: "2026-10-19T12:25:00.000-03:00" });
    expect(AdjustmentWebhookPayload.safeParse(f.sent[1].body).success).toBe(true);

    const late = await ag.patch(`${A}/${adj.id}`, { status: "done", agentNote: "Listo." });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ code: "adjustment_resolved", current: { status: "cancelled" } });
    expect((await user.post(`${A}/${adj.id}/cancel`)).body.code).toBe("adjustment_resolved");

    // proposed: too late to cancel (reject the proposal instead)
    const b = (await user.post(A, { date: DATE, text: "Se canceló Pamela." })).body;
    await ag.put(D, replan({ adjustmentIds: [b.id] }));
    const tooLate = await user.post(`${A}/${b.id}/cancel`);
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.code).toBe("adjustment_resolved");

    // failed resolves it at once and pushes; then nothing else is allowed
    const c = (await user.post(A, { date: DATE, text: "Algo raro" })).body;
    const failed = await ag.patch(`${A}/${c.id}`, { status: "failed", agentNote: "No entiendo qué cambió." });
    expect(failed.body).toMatchObject({ status: "failed", resolvedAt: expect.any(String) });
    expect(pushes.at(-1)).toMatchObject({ title: "Agenbot no pudo ajustar", body: "No entiendo qué cambió." });
    expect((await ag.patch(`${A}/${c.id}`, { status: "done", agentNote: "Ahora sí." })).status).toBe(409);

    // stale version
    const d = (await user.post(A, { date: DATE, text: "Otro" })).body;
    const stale = await ag.patch(`${A}/${d.id}`, { status: "done", agentNote: "x", version: 9 });
    expect(stale.body.code).toBe("version_conflict");
  });

  it("PUT adjustmentIds must be pending and for that date → else 422 adjustment_invalid (nothing applied)", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();
    const tomorrow = (await user.post(A, { date: "2026-10-20", text: "Mañana entro tarde" })).body;

    const otherDate = await ag.put(D, replan({ adjustmentIds: [tomorrow.id] }));
    expect(otherDate.status).toBe(422);
    expect(otherDate.body.code).toBe("adjustment_invalid");
    expect((await ag.put(D, replan({ adjustmentIds: ["019a0a6e-1c00-7000-8000-00000000dead"] }))).body.code).toBe("adjustment_invalid");

    await user.post(`${A}/${adj.id}/cancel`);
    expect((await ag.put(D, replan({ adjustmentIds: [adj.id] }))).body.code).toBe("adjustment_invalid");
    expect((await user.get(`${D}/proposals`)).body.proposals).toHaveLength(0);
  });

  it("draft day: the PUT applies directly, the request stays pending; done without proposal resolves it", async () => {
    await load();
    const { user } = await setupUser();
    await user.post("/api/push/subscribe", { endpoint: "https://push.test/1", keys: { p256dh: "k", auth: "a" } });
    setNow("2026-10-19T07:20:00-03:00");
    const adj = (await user.post(A, { date: DATE, text: "Hoy no voy al gym" })).body;

    const put = await agent().put(D, replan({ adjustmentIds: [adj.id] }));
    expect(put.status).toBe(200);
    expect((await user.get(`${A}/${adj.id}`)).body).toMatchObject({ status: "pending", proposal: null });

    const done = await agent().patch(`${A}/${adj.id}`, { status: "done", agentNote: "Saqué el gym de las dos opciones." });
    expect(done.body).toMatchObject({ status: "done", proposal: null, resolvedAt: expect.any(String) });
    expect(pushes.at(-1)).toMatchObject({ title: "Agenbot aplicó tu ajuste" });
  });

  it("one proposal can answer several requests; a newer proposal supersedes and resolves the older ones", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();
    const second = (await user.post(A, { date: DATE, text: "Se canceló Pamela." })).body;
    const third = (await user.post(A, { date: DATE, text: "Me surgió algo de 17 a 18." })).body;

    const p1 = (await ag.put(D, replan({ adjustmentIds: [adj.id, second.id] }))).body.proposal.id;
    for (const id of [adj.id, second.id]) expect((await user.get(`${A}/${id}`)).body).toMatchObject({ status: "proposed", proposal: { id: p1 } });

    setNow("2026-10-19T13:00:00-03:00");
    await ag.put(D, replan({ adjustmentIds: [third.id] }));
    const old = (await user.get(`${A}/${adj.id}`)).body;
    expect(old).toMatchObject({ proposal: { id: p1, status: "superseded" }, resolvedAt: "2026-10-19T13:00:00.000-03:00" });
    expect((await user.get(`${A}/${third.id}`)).body).toMatchObject({ status: "proposed", resolvedAt: null });
  });

  it("PATCH proposalId must belong to the same date", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();
    const p = (await ag.put(D, replan())).body.proposal.id;
    const tomorrow = (await user.post(A, { date: "2026-10-20", text: "x" })).body;
    const bad = await ag.patch(`${A}/${tomorrow.id}`, { status: "done", agentNote: "x", proposalId: p });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("adjustment_invalid");
    const ok = await ag.patch(`${A}/${adj.id}`, { status: "done", agentNote: "Ver propuesta.", proposalId: p });
    expect(ok.body).toMatchObject({ status: "done", proposal: { id: p, status: "pending" }, resolvedAt: null });
  });

  it("only my actions reach the webhook; actors are enforced", async () => {
    const { user, adj } = await chosenWithRequest();
    const ag = agent();
    const before = (await outbox()).length;
    await ag.put(D, replan({ adjustmentIds: [adj.id] }));
    await ag.patch(`${A}/${adj.id}`, { status: "done", agentNote: "Listo." });
    expect((await outbox()).length).toBe(before); // agent writes: no new rows

    expect((await ag.post(A, { date: DATE, text: "x" })).status).toBe(403);
    expect((await ag.post(`${A}/${adj.id}/cancel`)).status).toBe(403);
    expect((await user.patch(`${A}/${adj.id}`, { status: "done", agentNote: "x" })).status).toBe(403);
    expect((await user.get(`${A}/019a0a6e-1c00-7000-8000-00000000dead`)).status).toBe(404);
  });

  it("delivery failures retry with backoff and show in /api/webhook/status", async () => {
    const { user, adj } = await chosenWithRequest();
    const f = fakeFetch([503]);
    expect(await deliverDueWebhooks(new Date("2026-10-19T12:20:00-03:00"), f.fn)).toBe(0);
    const [row] = await getDb().select().from(webhookOutbox).where(eq(webhookOutbox.status, "pending"));
    expect(row).toMatchObject({ attempts: 1, lastError: "HTTP 503" });
    expect((row.payload as { adjustmentId: string }).adjustmentId).toBe(adj.id);
    const status = (await user.get("/api/webhook/status")).body;
    expect(status).toMatchObject({ queued: 1, lastDelivery: { status: "pending", lastError: "HTTP 503", lastResponseStatus: 503 } });

    expect(await deliverDueWebhooks(new Date("2026-10-19T12:20:29-03:00"), f.fn)).toBe(0); // backoff 30 s
    expect(await deliverDueWebhooks(new Date("2026-10-19T12:20:31-03:00"), f.fn)).toBe(1);
    expect(f.sent[1].body).toEqual(f.sent[0].body); // same event, same Idempotency-Key
    expect(f.sent[1].headers["Idempotency-Key"]).toBe(f.sent[0].headers["Idempotency-Key"]);
  });
});

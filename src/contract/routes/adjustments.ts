import { Adjustment, AdjustmentCreate, AdjustmentList, AdjustmentPatch, AdjustmentStatus } from "../adjustments";
import { LocalDate, Uuid } from "../common";
import * as ex from "../examples";
import { problem } from "../problems";
import type { RouteDef } from "../route-def";
import { z } from "../zod";

const IdParams = z.strictObject({ id: Uuid });
const etag = (v: number) => ({ ETag: `"${v}"` });

// 12:20 I write the request; 12:30 Agenbot answers with a proposal (PUT with adjustmentIds); 12:31 it closes it.
const pending: z.infer<typeof Adjustment> = {
  id: ex.uid(600),
  date: ex.DATE,
  text: "Laura pasó a las 15:00 y me surgió algo de 17 a 18.",
  status: "pending",
  agentNote: null,
  proposal: null,
  resolvedAt: null,
  version: 1,
  createdAt: "2026-10-19T12:20:04.118-03:00",
  updatedAt: "2026-10-19T12:20:04.118-03:00",
  updatedBy: "user",
};
export const adjustmentProposed: z.infer<typeof Adjustment> = {
  ...pending,
  status: "proposed",
  proposal: { id: ex.proposalPending.id, status: "pending" },
  version: 2,
  updatedAt: "2026-10-19T12:30:09.004-03:00",
  updatedBy: "agent",
};
const note = "Moví la llamada de Laura a las 15:00 y el gym a las 17:30; la lectura queda a las 14:00.";
const done: z.infer<typeof Adjustment> = { ...adjustmentProposed, status: "done", agentNote: note, version: 3, updatedAt: "2026-10-19T12:31:00.250-03:00" };
const failed: z.infer<typeof Adjustment> = {
  ...pending,
  id: ex.uid(601),
  text: "Se canceló Pamela.",
  status: "failed",
  agentNote: "No encuentro una llamada con Pamela hoy ni en tu calendario.",
  resolvedAt: "2026-10-19T13:05:40.000-03:00",
  version: 2,
  createdAt: "2026-10-19T13:05:01.000-03:00",
  updatedAt: "2026-10-19T13:05:40.000-03:00",
  updatedBy: "agent",
};
const cancelled: z.infer<typeof Adjustment> = {
  ...pending,
  id: ex.uid(602),
  text: "Me surgió algo de 14 a 16.",
  status: "cancelled",
  resolvedAt: "2026-10-19T13:10:30.000-03:00",
  version: 2,
  createdAt: "2026-10-19T13:10:00.000-03:00",
  updatedAt: "2026-10-19T13:10:30.000-03:00",
};

export const adjustmentRoutes: RouteDef[] = [
  {
    operationId: "createAdjustment",
    method: "post",
    path: "/api/adjustments",
    tag: "Adjustments",
    summary: "\"Pedir ajuste\": ask Agenbot to rearrange a day (user)",
    description:
      "Creates the request as `pending` and sends the `adjustment.requested` webhook right away (no debounce, not batched). The day may not be loaded yet. The agent answers with a proposal (`PUT /api/days/{date}` with `adjustmentIds`) and closes it with `PATCH /api/adjustments/{id}`.",
    access: "user",
    body: AdjustmentCreate,
    responses: {
      201: { description: "Created.", schema: Adjustment, headers: ["ETag"] },
      409: { description: "`day_closed`: the date is past or the day is closed." },
    },
    exchanges: [
      {
        name: "create",
        summary: "12:20 — Laura se movió y me surgió algo",
        actor: "user",
        headers: { "Idempotency-Key": "019a0a6e-ffff-7000-8000-000000000060" },
        body: { date: ex.DATE, text: pending.text },
        status: 201,
        response: pending,
        responseHeaders: etag(1),
      },
      {
        name: "closed",
        summary: "A past day",
        actor: "user",
        body: { date: "2026-10-18", text: "Se movió Carlos a las 15:00" },
        status: 409,
        response: problem(409, "day_closed", "2026-10-18 is closed."),
      },
    ],
  },
  {
    operationId: "listAdjustments",
    method: "get",
    path: "/api/adjustments",
    tag: "Adjustments",
    summary: "List adjustment requests",
    description: "Newest first. Agenbot: `?status=pending` after an `adjustment.requested` webhook (or to catch up after downtime).",
    access: "agent+user",
    query: z.strictObject({ date: LocalDate.optional(), status: AdjustmentStatus.optional() }),
    responses: { 200: { description: "Requests.", schema: AdjustmentList } },
    exchanges: [
      { name: "pending", summary: "Agenbot picks up pending requests", actor: "agent", query: { date: ex.DATE, status: "pending" }, status: 200, response: { adjustments: [pending] } },
      { name: "day", summary: "My requests for the day (Hoy)", actor: "user", query: { date: ex.DATE }, status: 200, response: { adjustments: [cancelled, failed, done] } },
    ],
  },
  {
    operationId: "getAdjustment",
    method: "get",
    path: "/api/adjustments/{id}",
    tag: "Adjustments",
    summary: "Get an adjustment request",
    access: "agent+user",
    params: IdParams,
    responses: {
      200: { description: "The request.", schema: Adjustment, headers: ["ETag"] },
      404: { description: "`not_found`." },
    },
    exchanges: [{ name: "proposed", summary: "Linked to a pending proposal", actor: "agent", params: { id: pending.id }, status: 200, response: adjustmentProposed, responseHeaders: etag(2) }],
  },
  {
    operationId: "patchAdjustment",
    method: "patch",
    path: "/api/adjustments/{id}",
    tag: "Adjustments",
    summary: "Close an adjustment request (agent)",
    description: [
      "`done` with a short note of what changed, or `failed` with the reason. Allowed from `pending` or `proposed`;",
      "`done | failed | cancelled` → 409 `adjustment_resolved` (with `current`). `proposalId` (optional) links a proposal of the same date, else 422 `adjustment_invalid`.",
      "Never triggers the webhook. I get a push when it fails, or when it is done without a proposal (applied to a draft day).",
    ].join(" "),
    access: "agent",
    params: IdParams,
    body: AdjustmentPatch,
    ifMatch: true,
    responses: {
      200: { description: "Updated.", schema: Adjustment, headers: ["ETag"] },
      404: { description: "`not_found`." },
      409: { description: "`adjustment_resolved`, `version_conflict`." },
      422: { description: "`adjustment_invalid`: the proposal is not for this date." },
    },
    exchanges: [
      {
        name: "done",
        summary: "12:31 — done, the proposal waits for me",
        actor: "agent",
        params: { id: pending.id },
        headers: { "Idempotency-Key": "agenbot-adj-600-done" },
        body: { status: "done", agentNote: note },
        status: 200,
        response: done,
        responseHeaders: etag(3),
      },
      {
        name: "failed",
        summary: "13:05 — nothing to change",
        actor: "agent",
        params: { id: failed.id },
        body: { status: "failed", agentNote: failed.agentNote },
        status: 200,
        response: failed,
        responseHeaders: etag(2),
      },
      {
        name: "resolved",
        summary: "Closing a request I already cancelled",
        actor: "agent",
        params: { id: cancelled.id },
        body: { status: "done", agentNote: "Listo." },
        status: 409,
        response: problem(409, "adjustment_resolved", "Adjustment is cancelled.", { current: cancelled }),
      },
    ],
  },
  {
    operationId: "cancelAdjustment",
    method: "post",
    path: "/api/adjustments/{id}/cancel",
    tag: "Adjustments",
    summary: "Cancel a pending request (user)",
    description: "Only while `pending`; sends the `adjustment.cancelled` webhook right away. Once there is a proposal, reject it instead.",
    access: "user",
    params: IdParams,
    responses: {
      200: { description: "Cancelled.", schema: Adjustment, headers: ["ETag"] },
      404: { description: "`not_found`." },
      409: { description: "`adjustment_resolved`: not `pending` any more." },
    },
    exchanges: [
      { name: "cancel", summary: "13:10 — never mind", actor: "user", params: { id: cancelled.id }, status: 200, response: cancelled, responseHeaders: etag(2) },
      {
        name: "proposed",
        summary: "Too late: Agenbot already proposed",
        actor: "user",
        params: { id: pending.id },
        status: 409,
        response: problem(409, "adjustment_resolved", "Adjustment is proposed; reject the proposal instead.", { current: adjustmentProposed }),
      },
    ],
  },
];

export const adjustmentWebhookExamples = [
  {
    name: "requested",
    summary: "12:20 — I ask for an adjustment",
    value: {
      event: "adjustment.requested",
      adjustmentId: pending.id,
      date: ex.DATE,
      text: pending.text,
      createdAt: pending.createdAt,
      adjustmentUrl: `https://agenda.lemydev.com/api/adjustments/${pending.id}`,
      dayUrl: `https://agenda.lemydev.com/api/days/${ex.DATE}`,
    },
  },
  {
    name: "cancelled",
    summary: "13:10 — I cancel it",
    value: {
      event: "adjustment.cancelled",
      adjustmentId: cancelled.id,
      date: ex.DATE,
      text: cancelled.text,
      createdAt: cancelled.createdAt,
      cancelledAt: cancelled.resolvedAt,
      adjustmentUrl: `https://agenda.lemydev.com/api/adjustments/${cancelled.id}`,
      dayUrl: `https://agenda.lemydev.com/api/days/${ex.DATE}`,
    },
  },
];

import { LocalDate, OptionLabel, Uuid } from "../common";
import * as ex from "../examples";
import {
  Block,
  BlockCreate,
  BlockExternalPatch,
  BlockPatch,
  ChooseInput,
  Day,
  DayInput,
  DayPatch,
  DaySummary,
  Proposal,
  PutDayResult,
  ReorderInput,
  ShiftInput,
} from "../planning";
import { problem } from "../problems";
import type { RouteDef } from "../route-def";
import { z } from "../zod";

const DateParams = z.strictObject({ date: LocalDate });
const BlockParams = z.strictObject({ date: LocalDate, id: Uuid });
const ExternalParams = z.strictObject({
  date: LocalDate,
  externalId: z.string().min(1).openapi({ description: "Google Calendar event id (URL-encoded)." }),
});
const ProposalParams = z.strictObject({ date: LocalDate, id: Uuid });

const D = { date: ex.DATE };
const etag = (v: number) => ({ ETag: `"${v}"` });

// "Me atrasé +30" from 11:00 on the chosen day: only my pending, unlocked agent/user blocks move; sleep stays.
const shifted = (() => {
  const a = ex.dayChosen.options[0];
  const add = (t: string, m: number) => {
    const total = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + m;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const at = "2026-10-19T11:04:00.000-03:00";
  const blocks = a.blocks
    .map((b) =>
      b.source !== "calendar" && b.status === "pending" && !b.locked && b.type !== "sleep" && b.start >= "11:00"
        ? {
            ...b,
            start: add(b.start, 30),
            end: b.end ? add(b.end, 30) : null,
            userOverrides: ["start", "end"] as ("start" | "end")[],
            version: b.version + 1,
            updatedAt: at,
            updatedBy: "user" as const,
          }
        : b,
    )
    .sort((x, y) => x.start.localeCompare(y.start));
  return { ...ex.dayChosen, status: "edited" as const, options: [{ ...a, blocks }, ex.dayChosen.options[1]], version: 3, updatedAt: at };
})();

const breakfastA = ex.dayChosen.options[0].blocks.find((b) => b.title === "Desayuno")!;
const optionB = ex.dayDraft.options[1];
const lauraB = optionB.blocks.find((b) => b.externalId === "7h3n1p5r8s2t4v6x9z0b1d3f5g")!;
const lauraA = ex.dayChosen.options[0].blocks.find((b) => b.externalId === "7h3n1p5r8s2t4v6x9z0b1d3f5g")!;
const lauraMoved = (b: typeof lauraA) => ({
  ...b,
  start: "15:00",
  end: "15:45",
  version: 2,
  updatedAt: "2026-10-19T12:20:00.000-03:00",
  updatedBy: "agent" as const,
});

export const planningRoutes: RouteDef[] = [
  {
    operationId: "getDay",
    method: "get",
    path: "/api/days/{date}",
    tag: "Days",
    summary: "Get a full day",
    description:
      "Options with blocks, tasks, habit logs and the pending proposal. Reading a past day that is not `closed` closes it first (lazy close).",
    access: "agent+user",
    params: DateParams,
    responses: {
      200: { description: "The day.", schema: Day, headers: ["ETag"] },
      404: { description: "`day_not_found`: the agent has not loaded this day." },
    },
    exchanges: [
      { name: "draft", summary: "07:01 — draft with options A and B", actor: "user", params: D, status: 200, response: ex.dayDraft, responseHeaders: etag(1) },
      { name: "editedWithProposal", summary: "12:35 — edited, with a pending agent proposal", actor: "user", params: D, status: 200, response: ex.dayEditedWithProposal, responseHeaders: etag(4) },
      { name: "notLoaded", summary: "Before 07:00 — not loaded yet", actor: "user", params: { date: "2026-10-20" }, status: 404, response: problem(404, "day_not_found", "No plan for 2026-10-20 yet.") },
    ],
  },
  {
    operationId: "putDay",
    method: "put",
    path: "/api/days/{date}",
    tag: "Days",
    summary: "Create or replace the whole day (agent)",
    description: [
      "Idempotent full replace. Calendar blocks are matched by `externalId`, agent blocks by `id`.",
      "- No day → **201** `created` (status `draft`).",
      "- `draft` → **200** `replaced` (my tracking fields are preserved on matched blocks).",
      "- `chosen | edited` → **202** `proposed`: nothing changes, a `Proposal` is created (superseding any pending one) and I get a push.",
      "- `?mode=force` → applied immediately with the same preservation rules (my tracking fields, `userOverrides`, `locked` blocks); logged as forced.",
      "- `closed` → **409** `day_closed`.",
      "Calendar blocks missing from the body are deleted, unless I already tracked them: then they are kept with `removedFromCalendarAt`.",
      "On `chosen | edited` days the body must include the chosen option's label (else 422 `validation_error`); options it omits are kept unchanged.",
    ].join("\n"),
    access: "agent",
    params: DateParams,
    query: z.strictObject({ mode: z.enum(["force"]).optional() }),
    body: DayInput,
    ifMatch: true,
    responses: {
      200: { description: "`replaced` (day was `draft`, or `?mode=force`).", schema: PutDayResult, headers: ["ETag"] },
      201: { description: "`created`.", schema: PutDayResult, headers: ["ETag"] },
      202: { description: "`proposed`: day unchanged, proposal created.", schema: PutDayResult },
      409: { description: "`day_closed` or `version_conflict` (when `If-Match` is sent)." },
    },
    exchanges: [
      {
        name: "load0700",
        summary: "07:00 — Agenbot loads the day: 4 calendar events + agent blocks, options A and B, checklist",
        actor: "agent",
        params: D,
        headers: { "Idempotency-Key": "agenbot-2026-10-19-0700" },
        body: ex.dayInput0700,
        status: 201,
        response: { result: "created", day: ex.dayDraft, proposal: null },
        responseHeaders: etag(1),
      },
      {
        name: "replanProposed",
        summary: "12:30 — I moved Laura's call in Google; Agenbot re-sends the day → proposal",
        actor: "agent",
        params: D,
        headers: { "Idempotency-Key": "agenbot-2026-10-19-1230" },
        body: ex.dayInputReplan,
        status: 202,
        response: { result: "proposed", day: ex.dayEditedWithProposal, proposal: ex.proposalPending },
      },
      {
        name: "closed",
        summary: "Writing a closed day",
        actor: "agent",
        params: { date: "2026-10-18" },
        body: ex.dayInput0700,
        status: 409,
        response: problem(409, "day_closed", "2026-10-18 is closed; the agent cannot modify it."),
      },
      {
        name: "invalid",
        summary: "Validation error (calendar block without externalId, bad time)",
        actor: "agent",
        params: D,
        invalidRequest: true,
        body: { options: [{ label: "A", title: "Plan", blocks: [{ source: "calendar", start: "9:30", title: "Llamada", type: "call" }] }] },
        status: 400,
        response: problem(400, "validation_error", "2 validation errors.", {
          errors: [
            { path: "/options/0/blocks/0/start", message: "Expected HH:mm (00:00–23:59)" },
            { path: "/options/0/blocks/0/externalId", message: "Required when source is calendar" },
          ],
        }),
      },
    ],
  },
  {
    operationId: "patchDay",
    method: "patch",
    path: "/api/days/{date}",
    tag: "Days",
    summary: "Update day fields",
    description: "`notes`, `callsSummary`, `weeklyGym`, `review`; `status: closed` (user only) closes the day early.",
    access: "agent+user",
    params: DateParams,
    body: DayPatch,
    ifMatch: true,
    responses: {
      200: { description: "Updated day.", schema: Day, headers: ["ETag"] },
      404: { description: "`day_not_found`." },
      409: { description: "`version_conflict`, `user_edit_conflict` (agent writing my review), `day_closed` (agent)." },
    },
    exchanges: [
      {
        name: "review",
        summary: "22:40 — I fill the end-of-day review",
        actor: "user",
        params: D,
        headers: { "If-Match": '"5"', "Idempotency-Key": "019a0a6e-ffff-7000-8000-000000000001" },
        body: { review: { energy: 4, mood: 4, text: "Buen día. Martín pide hablar con la pareja; Laura cerró follow-up." } },
        status: 200,
        response: {
          ...ex.dayAfterAccept,
          review: { energy: 4, mood: 4, text: "Buen día. Martín pide hablar con la pareja; Laura cerró follow-up." },
          reviewedAt: "2026-10-19T22:40:00.000-03:00",
          version: 6,
          updatedAt: "2026-10-19T22:40:00.000-03:00",
        },
        responseHeaders: etag(6),
      },
      {
        name: "conflict",
        summary: "Stale version",
        actor: "agent",
        params: D,
        body: { callsSummary: "Martín → follow-up jueves.", version: 3 },
        status: 409,
        response: problem(409, "version_conflict", "Expected version 3, current is 5.", { current: { version: 5 } }),
      },
    ],
  },
  {
    operationId: "chooseOption",
    method: "post",
    path: "/api/days/{date}/choose",
    tag: "Days",
    summary: "Choose a plan option",
    description: "Allowed while `draft` or `chosen` (switching). `edited` / `closed` → 409. Sends the webhook immediately.",
    access: "agent+user",
    params: DateParams,
    body: ChooseInput,
    ifMatch: true,
    responses: {
      200: { description: "Day with `status: chosen`.", schema: Day, headers: ["ETag"] },
      404: { description: "`not_found`: no such option label." },
      409: { description: "`invalid_transition`, `day_closed`, `version_conflict`." },
    },
    exchanges: [
      { name: "chooseA", summary: "07:42 — I choose option A", actor: "user", params: D, body: { option: "A", version: 1 }, status: 200, response: ex.dayChosen, responseHeaders: etag(2) },
      {
        name: "edited",
        summary: "Switching option after editing",
        actor: "user",
        params: D,
        body: { option: "B" },
        status: 409,
        response: problem(409, "invalid_transition", "Cannot switch option on an edited day."),
      },
    ],
  },
  {
    operationId: "shiftDay",
    method: "post",
    path: "/api/days/{date}/shift",
    tag: "Days",
    summary: "\"Me atrasé\": shift my pending blocks",
    description:
      "Moves pending, unlocked `agent`/`user` blocks of the chosen option starting at or after `fromTime`. Calendar and `sleep` blocks never move. When the user shifts, `start`/`end` are added to `userOverrides`.",
    access: "agent+user",
    params: DateParams,
    body: ShiftInput,
    ifMatch: true,
    responses: {
      200: { description: "Updated day.", schema: Day, headers: ["ETag"] },
      409: { description: "`invalid_transition` (draft), `day_closed`, `version_conflict`." },
      422: { description: "`shift_out_of_range`." },
    },
    exchanges: [
      { name: "plus30", summary: "11:04 — +30 min from 11:00", actor: "user", params: D, body: { fromTime: "11:00", minutes: 30 }, status: 200, response: shifted, responseHeaders: etag(3) },
      {
        name: "outOfRange",
        summary: "+60 at night would push pádel past midnight",
        actor: "user",
        params: D,
        body: { fromTime: "21:30", minutes: 180 },
        status: 422,
        response: problem(422, "shift_out_of_range", "\"Tiempo en pareja\" would start at 00:45."),
      },
    ],
  },
  {
    operationId: "listProposals",
    method: "get",
    path: "/api/days/{date}/proposals",
    tag: "Proposals",
    summary: "List proposals for a day",
    access: "agent+user",
    params: DateParams,
    responses: { 200: { description: "Newest first.", schema: z.strictObject({ proposals: z.array(Proposal) }) } },
    exchanges: [{ name: "list", summary: "One pending proposal", actor: "user", params: D, status: 200, response: { proposals: [ex.proposalPending] } }],
  },
  {
    operationId: "acceptProposal",
    method: "post",
    path: "/api/days/{date}/proposals/{id}/accept",
    tag: "Proposals",
    summary: "Accept a proposal (user)",
    description:
      "Applies the payload: blocks matched by `externalId`, then `id`; my tracking fields, `userOverrides` and `locked` blocks are preserved. Webhook sent immediately.",
    access: "user",
    params: ProposalParams,
    ifMatch: true,
    responses: {
      200: { description: "Updated day.", schema: Day, headers: ["ETag"] },
      404: { description: "`not_found`." },
      409: { description: "`invalid_transition` (not pending), `version_conflict`." },
    },
    exchanges: [
      { name: "accept", summary: "12:41 — I accept", actor: "user", params: { date: ex.DATE, id: ex.proposalPending.id }, status: 200, response: ex.dayAfterAccept, responseHeaders: etag(5) },
      {
        name: "superseded",
        summary: "Accepting an old proposal",
        actor: "user",
        params: { date: ex.DATE, id: ex.uid(499) },
        status: 409,
        response: problem(409, "invalid_transition", "Proposal is superseded."),
      },
    ],
  },
  {
    operationId: "rejectProposal",
    method: "post",
    path: "/api/days/{date}/proposals/{id}/reject",
    tag: "Proposals",
    summary: "Reject a proposal (user)",
    access: "user",
    params: ProposalParams,
    responses: {
      200: { description: "The rejected proposal.", schema: Proposal },
      404: { description: "`not_found`." },
      409: { description: "`invalid_transition`." },
    },
    exchanges: [
      {
        name: "reject",
        summary: "I reject",
        actor: "user",
        params: { date: ex.DATE, id: ex.proposalPending.id },
        status: 200,
        response: { ...ex.proposalPending, status: "rejected", resolvedAt: "2026-10-19T12:41:30.120-03:00" },
      },
    ],
  },
  {
    operationId: "createBlock",
    method: "post",
    path: "/api/days/{date}/blocks",
    tag: "Blocks",
    summary: "Add a block",
    description:
      "Added to the chosen option, or to `?option=` (required while `draft`). A user block makes a `chosen` day `edited`; all its schedule fields are mine (`userOverrides`). Only the agent may add `calendar` blocks.",
    access: "agent+user",
    params: DateParams,
    query: z.strictObject({ option: OptionLabel.optional() }),
    body: BlockCreate,
    responses: {
      201: { description: "Created block.", schema: Block },
      409: { description: "`day_closed` (agent), `forbidden` source." },
    },
    exchanges: [
      {
        name: "userBlock",
        summary: "I add \"Pagar alquiler del local\"",
        actor: "user",
        params: D,
        body: { id: ex.uid(600), start: "09:50", end: "10:00", title: "Pagar alquiler del local", type: "other" },
        status: 201,
        response: {
          ...ex.blockDogsA,
          id: ex.uid(600),
          start: "09:50",
          end: "10:00",
          title: "Pagar alquiler del local",
          type: "other",
          source: "user",
          userOverrides: ["start", "end", "title", "type", "detail", "lead", "order"],
          order: 0,
          createdAt: "2026-10-19T09:31:00.000-03:00",
          updatedAt: "2026-10-19T09:31:00.000-03:00",
          updatedBy: "user",
        },
      },
    ],
  },
  {
    operationId: "patchBlock",
    method: "patch",
    path: "/api/days/{date}/blocks/{id}",
    tag: "Blocks",
    summary: "Edit a block",
    description: [
      "Ownership rules:",
      "- Calendar blocks: schedule fields → 409 `calendar_owned` for me.",
      "- Agent/user blocks: each schedule field I edit joins `userOverrides`. The agent writing one of those, or anything on a `locked` block → 409 `user_edit_conflict` (agent `force: true` overrides, except `locked`).",
      "- Tracking fields (`status`, `outcome`, `note`) are mine; the agent may set them only while unset / `pending`.",
    ].join("\n"),
    access: "agent+user",
    params: BlockParams,
    body: BlockPatch,
    ifMatch: true,
    responses: {
      200: { description: "Updated block.", schema: Block },
      404: { description: "`not_found`." },
      409: { description: "`calendar_owned`, `user_edit_conflict`, `version_conflict`, `day_closed` (agent)." },
    },
    exchanges: [
      {
        name: "callDone",
        summary: "10:48 — Martín's call done, outcome follow_up",
        actor: "user",
        params: { date: ex.DATE, id: ex.blockMartinA.id },
        headers: { "If-Match": '"1"' },
        body: { status: "done", outcome: "follow_up", note: ex.blockMartinDone.note },
        status: 200,
        response: ex.blockMartinDone,
      },
      {
        name: "move",
        summary: "10:50 — I move reading to 11:15",
        actor: "user",
        params: { date: ex.DATE, id: ex.blockReadingA.id },
        body: { start: "11:15", end: "11:45", version: 1 },
        status: 200,
        response: ex.blockReadingMoved,
      },
      {
        name: "agentGymDone",
        summary: "13:02 — I tell Agenbot \"ya fui al gym\"; it marks the block done",
        actor: "agent",
        params: { date: ex.DATE, id: ex.blockGymA.id },
        body: { status: "done" },
        status: 200,
        response: { ...ex.blockGymDone, updatedBy: "agent" },
      },
      {
        name: "calendarOwned",
        summary: "I try to move a calendar event",
        actor: "user",
        params: { date: ex.DATE, id: ex.blockMartinA.id },
        body: { start: "10:30" },
        status: 409,
        response: problem(409, "calendar_owned", "Edit this event in Google Calendar.", { current: ex.blockMartinA }),
      },
      {
        name: "overrideConflict",
        summary: "Agent moves a block whose start I edited",
        actor: "agent",
        params: { date: ex.DATE, id: ex.blockReadingA.id },
        body: { start: "14:00", end: "14:30" },
        status: 409,
        response: problem(409, "user_edit_conflict", "Fields edited by the user: start, end. Send force: true to override.", {
          current: ex.blockReadingMoved,
        }),
      },
      {
        name: "trackingConflict",
        summary: "Agent changes an outcome I already set",
        actor: "agent",
        params: { date: ex.DATE, id: ex.blockMartinA.id },
        body: { outcome: "closed_won" },
        status: 409,
        response: problem(409, "user_edit_conflict", "outcome was set by the user.", { current: ex.blockMartinDone }),
      },
    ],
  },
  {
    operationId: "patchBlockByExternal",
    method: "patch",
    path: "/api/days/{date}/blocks/by-external/{externalId}",
    tag: "Blocks",
    summary: "Mirror a Google Calendar change (agent)",
    description: "Applied to every copy of the event (one per option). Tracking fields follow the usual ownership rules.",
    access: "agent",
    params: ExternalParams,
    body: BlockExternalPatch,
    responses: {
      200: { description: "All updated copies.", schema: z.strictObject({ blocks: z.array(Block) }) },
      404: { description: "`not_found`: no block with that externalId on this day." },
      409: { description: "`user_edit_conflict` (tracking fields), `day_closed`." },
    },
    exchanges: [
      {
        name: "moved",
        summary: "Laura's event moved to 15:00 in Google (day still draft)",
        actor: "agent",
        params: { date: ex.DATE, externalId: "7h3n1p5r8s2t4v6x9z0b1d3f5g" },
        body: { start: "15:00", end: "15:45" },
        status: 200,
        response: { blocks: [lauraMoved(lauraA), lauraMoved(lauraB)] },
      },
    ],
  },
  {
    operationId: "deleteBlock",
    method: "delete",
    path: "/api/days/{date}/blocks/{id}",
    tag: "Blocks",
    summary: "Delete a block",
    description: "Calendar blocks → 409 `calendar_owned` for me. The agent cannot delete my blocks or blocks I tracked (`user_edit_conflict`).",
    access: "agent+user",
    params: BlockParams,
    ifMatch: true,
    responses: {
      204: { description: "Deleted." },
      404: { description: "`not_found`." },
      409: { description: "`calendar_owned`, `user_edit_conflict`, `version_conflict`." },
    },
    exchanges: [
      { name: "delete", summary: "I delete the reading block", actor: "user", params: { date: ex.DATE, id: ex.blockReadingA.id }, status: 204 },
      {
        name: "calendar",
        summary: "I try to delete pádel",
        actor: "user",
        params: { date: ex.DATE, id: ex.dayChosen.options[0].blocks.find((b) => b.type === "padel")!.id },
        status: 409,
        response: problem(409, "calendar_owned", "Delete this event in Google Calendar."),
      },
    ],
  },
  {
    operationId: "reorderBlocks",
    method: "post",
    path: "/api/days/{date}/blocks/reorder",
    tag: "Blocks",
    summary: "Reorder blocks of one option",
    description: "Sets `order` (tie-breaker among blocks with the same start). Moving in time is a `PATCH` of `start`.",
    access: "agent+user",
    params: DateParams,
    body: ReorderInput,
    ifMatch: true,
    responses: {
      200: { description: "Reordered blocks.", schema: z.strictObject({ blocks: z.array(Block) }) },
      409: { description: "`calendar_owned`, `version_conflict`." },
    },
    exchanges: [
      {
        name: "reorder",
        summary: "Swap breakfast and the dog walk (tie-breaker order)",
        actor: "user",
        params: D,
        body: { ids: [breakfastA.id, ex.blockDogsA.id] },
        status: 200,
        response: {
          blocks: [
            { ...breakfastA, order: 0, userOverrides: ["order"], version: 2, updatedBy: "user" },
            { ...ex.blockDogsA, order: 1, userOverrides: ["order"], version: 2, updatedBy: "user" },
          ],
        },
      },
    ],
  },
  {
    operationId: "listDays",
    method: "get",
    path: "/api/days",
    tag: "Days",
    summary: "Day summaries for history",
    description: "Max range 400 days.",
    access: "agent+user",
    query: z.strictObject({ from: LocalDate, to: LocalDate }),
    responses: { 200: { description: "Ascending by date.", schema: z.strictObject({ days: z.array(DaySummary) }) } },
    exchanges: [
      {
        name: "week",
        summary: "Last days",
        actor: "user",
        query: { from: "2026-10-17", to: "2026-10-19" },
        status: 200,
        response: {
          days: [
            { date: "2026-10-17", status: "closed", chosenOption: "B", blocksTotal: 11, blocksDone: 9, blocksSkipped: 2, completion: 0.82, callsTotal: 0, review: { energy: 3, mood: 4, text: null }, hasPendingProposal: false, version: 9 },
            { date: "2026-10-18", status: "closed", chosenOption: "A", blocksTotal: 9, blocksDone: 6, blocksSkipped: 1, completion: 0.67, callsTotal: 1, review: null, hasPendingProposal: false, version: 7 },
            { date: "2026-10-19", status: "edited", chosenOption: "A", blocksTotal: 12, blocksDone: 2, blocksSkipped: 0, completion: 0.17, callsTotal: 2, review: null, hasPendingProposal: true, version: 4 },
          ],
        },
      },
    ],
  },
];

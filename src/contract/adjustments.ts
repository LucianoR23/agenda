import { ExpectedVersion, LocalDate, Mutable, orNull, Timestamp, Uuid } from "./common";
import { ProposalStatus } from "./planning";
import { z } from "./zod";

// "Pedir ajuste": I describe in plain words what changed; Agenbot answers with a proposal.

export const AdjustmentStatus = z.enum(["pending", "proposed", "done", "failed", "cancelled"]).openapi("AdjustmentStatus", {
  description:
    "`pending` (just sent) → `proposed` (the agent linked a proposal) → `done` | `failed` (the agent closed it). I can cancel it only while `pending`.",
});

export const Adjustment = z
  .strictObject({
    id: Uuid,
    date: LocalDate,
    text: z.string(),
    status: AdjustmentStatus,
    agentNote: z.string().nullable().openapi({ description: "Short answer from the agent (what it moved, or why it couldn't)." }),
    proposal: orNull(z.strictObject({ id: Uuid, status: ProposalStatus })).openapi({
      description: "The linked proposal and its current status: `pending` = ready for me to accept or reject.",
    }),
    resolvedAt: orNull(Timestamp).openapi({
      description: "Set when nothing is left to do: `failed`, `cancelled`, `done` without a proposal, or once the linked proposal is accepted, rejected or superseded.",
    }),
    ...Mutable,
  })
  .openapi("Adjustment");

export const AdjustmentCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated UUIDv7 (offline creates)." }),
    date: LocalDate.openapi({ description: "Day it applies to; it may not be loaded yet. Closed or past days → 409 `day_closed`." }),
    text: z.string().trim().min(1).max(1000),
  })
  .openapi("AdjustmentCreate");

export const AdjustmentPatch = z
  .strictObject({
    status: z.enum(["done", "failed"]),
    agentNote: z.string().trim().min(1).max(500),
    proposalId: Uuid.optional().openapi({ description: "Link a proposal of the same date (alternative to `adjustmentIds` in the PUT)." }),
    version: ExpectedVersion,
  })
  .openapi("AdjustmentPatch");

export const AdjustmentList = z.strictObject({ adjustments: z.array(Adjustment) }).openapi("AdjustmentList");

/** Outbound event, one per request (not batched, no debounce). */
export const AdjustmentWebhookPayload = z
  .strictObject({
    event: z.enum(["adjustment.requested", "adjustment.cancelled"]),
    adjustmentId: Uuid,
    date: LocalDate,
    text: z.string(),
    createdAt: Timestamp,
    cancelledAt: Timestamp.optional().openapi({ description: "On `adjustment.cancelled`." }),
    adjustmentUrl: z.url(),
    dayUrl: z.url(),
  })
  .openapi("AdjustmentWebhookPayload");

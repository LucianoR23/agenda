import type { ZodType } from "zod";
import { z } from "./zod";

/**
 * `schema | null`. Use instead of `.nullable()` on named (registered) schemas: zod-to-openapi drops the
 * null branch for `$ref`s, while an explicit union emits `anyOf: [$ref, {type: null}]`.
 */
export const orNull = <T extends ZodType>(schema: T) => z.union([schema, z.null()]);

export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Invalid calendar date")
  .openapi("LocalDate", {
    description: "Local date in America/Buenos_Aires, `YYYY-MM-DD`.",
    example: "2026-10-19",
  });

export const LocalTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Expected HH:mm (00:00–23:59)")
  .openapi("LocalTime", {
    description: "Local time in America/Buenos_Aires, `HH:mm`, 24 h.",
    example: "09:30",
  });

export const BlockTime = z
  .string()
  .regex(/^([01][0-9]|2[0-9]):[0-5][0-9]$/, "Expected HH:mm (00:00–29:59)")
  .openapi("BlockTime", {
    description:
      "Block time on the block's day, `HH:mm`, 00:00–29:59. `24:00`–`29:59` = after midnight (shown as `00:15 (+1)`); the block still belongs to the day it starts. For `end`, a value lower than `start` also means the next day (sleep `23:30`→`07:00`).",
    example: "24:15",
  });

export const Timestamp = z.iso.datetime({ offset: true }).openapi("Timestamp", {
  description: "ISO 8601 timestamp with offset (the API always answers in -03:00).",
  example: "2026-10-19T07:00:12.345-03:00",
});

export const Uuid = z.uuid().openapi("Uuid", { example: "019a0a6e-5c3e-7b2a-9d41-3f0c8a1b2c3d" });

export const Actor = z.enum(["agent", "user", "system"]).openapi("Actor");

export const OptionLabel = z
  .string()
  .regex(/^[A-Z]$/)
  .openapi("OptionLabel", { description: "Plan option label, `A`–`Z`.", example: "A" });

/** Optimistic-concurrency field accepted in write bodies as an alternative to `If-Match`. */
export const ExpectedVersion = z.int().min(1).optional().openapi({
  description: "Expected current version. Alternative to the `If-Match` header; mismatch → 409 `version_conflict`.",
});

export const Mutable = {
  version: z.int().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  updatedBy: Actor,
};

export const ErrorCode = z
  .enum([
    "validation_error",
    "unauthorized",
    "device_locked",
    "forbidden",
    "not_found",
    "day_not_found",
    "method_not_allowed",
    "version_conflict",
    "calendar_owned",
    "user_edit_conflict",
    "day_closed",
    "invalid_transition",
    "shift_out_of_range",
    "idempotency_key_reuse",
    "idempotency_in_progress",
    "rate_limited",
    "locked_out",
    "invalid_credentials",
    "setup_completed",
    "adjustment_resolved",
    "adjustment_invalid",
    "internal_error",
    "service_unavailable",
  ])
  .openapi("ErrorCode");

export const Problem = z
  .object({
    type: z.string().openapi({ example: "https://agenda.lemydev.com/problems/version_conflict" }),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    code: ErrorCode.optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: "Field-level validation errors (JSON-pointer-like paths)." }),
    requestId: z.string(),
    current: z
      .unknown()
      .optional()
      .openapi({
        description:
          "On `version_conflict` / `user_edit_conflict` / `calendar_owned`: the current server state of the resource.",
      }),
    retryAfterSeconds: z.int().optional().openapi({ description: "On `rate_limited` / `locked_out`." }),
    remainingAttempts: z.int().optional().openapi({ description: "On `invalid_credentials` (PIN / codes)." }),
  })
  .openapi("Problem", { description: "RFC 9457 problem details (`application/problem+json`)." });

export type ProblemBody = z.infer<typeof Problem>;

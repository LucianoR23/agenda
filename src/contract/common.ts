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
    description: "Calendar date in the user's timezone, `YYYY-MM-DD`.",
    example: "2026-10-19",
  });

export const LocalTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Expected HH:mm (00:00–23:59)")
  .openapi("LocalTime", {
    description: "Local time in the user's timezone, `HH:mm`, 24 h.",
    example: "09:30",
  });

export const Timestamp = z.iso.datetime({ offset: true }).openapi("Timestamp", {
  description: "ISO 8601 timestamp with offset .",
  example: "2026-10-19T07:00:12.345-03:00",
});

/**
 * Forgiving date-time input (Sunday): ISO 8601 with or without offset. Without one it's the user's wall time
 * (`2026-11-14T09:00` = 09:00 in Buenos Aires).
 */
export const DateTimeInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:\d{2})?$/, "Expected an ISO date-time, e.g. 2026-11-14T09:00")
  .refine((s) => !Number.isNaN(new Date(`${s.slice(0, 16)}:00Z`).getTime()), "Invalid date-time")
  .openapi("DateTimeInput", {
    description: "ISO 8601 date-time. With offset (`-03:00`, `Z`) it's that instant; without, the user's local time.",
    example: "2026-11-14T09:00",
  });

/** Caller-chosen idempotency handle on creates. */
export const ClientId = z.string().trim().min(1).max(100).openapi("ClientId", {
  description:
    "Your own id for this item (≤ 100 chars). Sending the same clientId again doesn't duplicate: it returns the existing item (200), updated with the fields you sent.",
  example: "sunday-2026-11-14-contador",
});

/** Human-readable time in Spanish, for reading back to the user. */
export const WhenText = z.string().nullable().openapi({
  description: 'When, in Spanish, ready to say: "jueves 14 de noviembre, 09:00". The year only when it is not this year.',
  example: "jueves 14 de noviembre, 09:00",
});

export const AppUrl = z.url().openapi({ description: "Opens it in the agenda app." });

export const Uuid = z.uuid().openapi("Uuid", { example: "019a0a6e-5c3e-7b2a-9d41-3f0c8a1b2c3d" });

/** Who created or last changed something: Lemy in the app, an API token (Sunday), or the app itself. */
export const ItemSource = z.enum(["user", "sunday", "system"]).openapi("ItemSource");

/** Optimistic-concurrency field accepted in write bodies as an alternative to `If-Match`. */
export const ExpectedVersion = z.int().min(1).optional().openapi({
  description: "Expected current version. Alternative to the `If-Match` header; mismatch → 409 `VERSION_CONFLICT`.",
});

export const Mutable = {
  version: z.int().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  updatedBy: ItemSource,
};

export const ErrorCode = z
  .enum([
    "VALIDATION_ERROR",
    "UNSUPPORTED_MEDIA_TYPE",
    "UNAUTHORIZED",
    "DEVICE_LOCKED",
    "REAUTH_REQUIRED",
    "FORBIDDEN",
    "ORIGIN_NOT_ALLOWED",
    "INSUFFICIENT_SCOPE",
    "NOT_FOUND",
    "SETUP_REQUIRED",
    "SETUP_COMPLETED",
    "METHOD_NOT_ALLOWED",
    "VERSION_CONFLICT",
    "CONFLICT",
    "READ_ONLY_EVENT",
    "IDEMPOTENCY_KEY_REUSE",
    "IDEMPOTENCY_IN_PROGRESS",
    "RATE_LIMITED",
    "LOCKED_OUT",
    "INVALID_CREDENTIALS",
    "INTERNAL_ERROR",
    "SERVICE_UNAVAILABLE",
  ])
  .openapi("ErrorCode");
export type ErrorCodeT = z.infer<typeof ErrorCode>;

/**
 * Every error response: `{ "error": { "code", "message", "details"?, "requestId" } }`. `message` is a plain
 * Spanish sentence written for both the UI and an LLM caller (it says what to do next).
 */
export const ErrorBody = z
  .strictObject({
    error: z.strictObject({
      code: ErrorCode,
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional().openapi({
        description:
          "Extra data by code: `fields` (VALIDATION_ERROR: [{ path, message }]), `retryAfterSeconds` (RATE_LIMITED, LOCKED_OUT), `remainingAttempts` (INVALID_CREDENTIALS), `current` (VERSION_CONFLICT: the server's copy), `requiredScope` (INSUFFICIENT_SCOPE).",
      }),
      requestId: z.string(),
    }),
  })
  .openapi("Error");

export type ErrorBodyT = z.infer<typeof ErrorBody>;

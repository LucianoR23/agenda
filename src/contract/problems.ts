import type { ProblemBody } from "./common";

type Code = NonNullable<ProblemBody["code"]>;

const TITLES: Record<Code, string> = {
  validation_error: "Request validation failed",
  unauthorized: "Authentication required",
  device_locked: "Device locked, unlock with PIN or fingerprint",
  forbidden: "Not allowed for this actor",
  not_found: "Resource not found",
  day_not_found: "Day not loaded yet",
  method_not_allowed: "Method not allowed",
  version_conflict: "Version conflict",
  calendar_owned: "Owned by Google Calendar",
  user_edit_conflict: "Field edited by the user",
  day_closed: "Day is closed",
  invalid_transition: "Invalid status transition",
  shift_out_of_range: "Shift would cross midnight",
  idempotency_key_reuse: "Idempotency-Key reused with a different body",
  idempotency_in_progress: "A request with this Idempotency-Key is still in progress",
  rate_limited: "Too many requests",
  locked_out: "Too many failed attempts",
  invalid_credentials: "Invalid credentials",
  setup_completed: "Setup already completed",
  adjustment_resolved: "Adjustment request already resolved",
  adjustment_invalid: "Adjustment request cannot be linked",
  internal_error: "Internal error",
  service_unavailable: "Service unavailable",
};

export const problemTitle = (code: Code) => TITLES[code];

/** Builds a problem+json body. Used by the API at runtime and by the examples. */
export function problem(
  status: number,
  code: Code,
  detail?: string,
  extra: Partial<ProblemBody> = {},
  requestId = "req_01JA9X7Q2M8K",
): ProblemBody {
  return {
    type: `https://agenda.lemydev.com/problems/${code}`,
    title: TITLES[code],
    status,
    ...(detail ? { detail } : {}),
    code,
    requestId,
    ...extra,
  };
}

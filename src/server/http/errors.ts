import type { ProblemBody } from "@/contract/common";
import { problem } from "@/contract/problems";

type Code = NonNullable<ProblemBody["code"]>;

/** Throw anywhere in a handler; the router turns it into problem+json. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: Code,
    detail?: string,
    readonly extra: Partial<ProblemBody> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? code);
  }

  toBody(requestId: string): ProblemBody {
    return problem(this.status, this.code, this.message === this.code ? undefined : this.message, this.extra, requestId);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
export const forbidden = (detail = "Not allowed for this actor.") => new ApiError(403, "forbidden", detail);
export const versionConflict = (expected: number, current: unknown, currentVersion: number) =>
  new ApiError(409, "version_conflict", `Expected version ${expected}, current is ${currentVersion}.`, { current });
export const dayClosed = (date: string) => new ApiError(409, "day_closed", `${date} is closed; the agent cannot modify it.`);
export const calendarOwned = (current: unknown, detail = "Edit this event in Google Calendar.") =>
  new ApiError(409, "calendar_owned", detail, { current });
export const userEditConflict = (detail: string, current: unknown) => new ApiError(409, "user_edit_conflict", detail, { current });
export const invalidTransition = (detail: string) => new ApiError(409, "invalid_transition", detail);
export const validation = (errors: Array<{ path: string; message: string }>, status = 400) =>
  new ApiError(status, "validation_error", `${errors.length} validation error${errors.length === 1 ? "" : "s"}.`, { errors });

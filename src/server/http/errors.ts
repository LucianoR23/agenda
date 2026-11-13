import type { ErrorBodyT, ErrorCodeT } from "@/contract/common";
import { errorBody } from "@/contract/errors";

/** Throw anywhere in a handler; the router turns it into `{ error: { code, message, details } }`. */
export class ApiError extends Error {
  readonly details: Record<string, unknown> | undefined;
  constructor(
    readonly status: number,
    readonly code: ErrorCodeT,
    message?: string,
    details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
    this.details = details;
  }

  toBody(requestId: string): ErrorBodyT {
    return errorBody(this.code, this.message === this.code ? undefined : this.message, this.details, requestId);
  }
}

export const notFound = (message = "No encontré lo que buscabas.") => new ApiError(404, "NOT_FOUND", message);
export const forbidden = (message?: string) => new ApiError(403, "FORBIDDEN", message);
export const versionConflict = (current: unknown) => new ApiError(409, "VERSION_CONFLICT", undefined, { current });
export const validation = (fields: Array<{ path: string; message: string }>) =>
  new ApiError(400, "VALIDATION_ERROR", `Datos inválidos: ${fields.map((f) => `${f.path} (${f.message})`).join(", ")}.`, { fields });

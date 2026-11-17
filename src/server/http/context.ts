import type { DbLike } from "../db/client";
import type { ItemSource, TokenScope } from "../db/schema";
import type { DeviceRow } from "../domain/rows";
import { ApiError } from "./errors";

/** Who is calling: Lemy's app (session cookie), an API token, or nobody (public/pre-auth routes). */
export type Caller =
  | { kind: "user"; deviceId: string }
  | { kind: "token"; tokenId: string; name: string; scopes: readonly TokenScope[] }
  | { kind: "anonymous" };

export interface Ctx {
  requestId: string;
  req: Request;
  /** One clock reading per request (injectable in tests). */
  now: Temporal.Instant;
  caller: Caller;
  /** The user's IANA timezone (app_user.timezone), for every local date/time in responses. */
  tz: string;
  /** Device of a valid session cookie, even if locked (pre-auth routes need it). */
  sessionDevice: DeviceRow | null;
  sessionLocked: boolean;
  /** Pre-auth device key (cookie), used for per-device lockout before a device row exists. */
  deviceKey: string;
  /** Client IP resolved from trusted proxy headers only (see ip.ts). */
  ip: string | null;
  userAgent: string | null;
  /** Expected version from `If-Match`. */
  ifMatch: number | null;
  /** Set-Cookie headers to add to the response. */
  setCookies: string[];
  db: DbLike;
  /** Side effects to run only if the request transaction commits (pushes). */
  afterCommit: Array<() => Promise<void>>;
}

/** `source` / `updated_by` for whatever this request writes. */
export const sourceOf = (caller: Caller): ItemSource => (caller.kind === "user" ? "user" : caller.kind === "token" ? "sunday" : "system");

/** The API token behind this request, for change_log / audit_event. */
export const tokenIdOf = (caller: Caller): string | null => (caller.kind === "token" ? caller.tokenId : null);

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Input already validated by the router against the route's Zod schemas. Typed per operation once handlers are
 * generated from the contract (phase 4); until then the shapes are trusted from the schemas.
 */
// biome-ignore lint/suspicious/noExplicitAny: values are Zod-validated by the router before reaching a handler
type Validated = any;

export type Handler = (ctx: Ctx, input: { params: Validated; query: Validated; body: Validated }) => Promise<HandlerResult>;

/** Device of the authenticated session. The router guarantees it on session routes; anything else is a 401. */
export function requireDevice(ctx: Pick<Ctx, "sessionDevice">): DeviceRow {
  if (!ctx.sessionDevice) throw new ApiError(401, "UNAUTHORIZED");
  return ctx.sessionDevice;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): HandlerResult =>
  headers ? { status, body, headers } : { status, body };

/** Strong ETag from a version. */
export const etag = (version: number) => ({ ETag: `"${version}"` });

/** Expected version from `If-Match` or the body field; body wins when both are present. */
export const expectedVersion = (ctx: Ctx, bodyVersion?: number) => bodyVersion ?? ctx.ifMatch;

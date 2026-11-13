import type { DbLike } from "../db/client";
import type { DeviceRow } from "../domain/rows";
import { ApiError } from "./errors";

export type Actor = "user";

export interface Ctx {
  requestId: string;
  req: Request;
  now: Date;
  /** Who is calling. `anonymous` on public/pre-auth routes. Named API tokens arrive in phase 3. */
  caller: Actor | "anonymous";
  /** Device of a valid session cookie, even if locked (pre-auth routes need it). */
  sessionDevice: DeviceRow | null;
  sessionLocked: boolean;
  /** Pre-auth device key (cookie), used for per-device lockout before a device row exists. */
  deviceKey: string;
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

/** Actor for `updated_by` / ChangeLog: user, or system (background jobs). */
export const writer = (ctx: Pick<Ctx, "caller">): "user" | "system" => (ctx.caller === "user" ? "user" : "system");

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

/** Device of the authenticated session. The router guarantees it on `user` routes; anything else is a 401. */
export function requireDevice(ctx: Pick<Ctx, "sessionDevice">): DeviceRow {
  if (!ctx.sessionDevice) throw new ApiError(401, "unauthorized", "Authentication required.");
  return ctx.sessionDevice;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): HandlerResult => ({ status, body, headers });

/** Strong ETag from a version. */
export const etag = (version: number) => ({ ETag: `"${version}"` });

/** Expected version from `If-Match` or the body field; body wins when both are present. */
export const expectedVersion = (ctx: Ctx, bodyVersion?: number) => bodyVersion ?? ctx.ifMatch;

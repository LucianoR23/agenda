import type { DbLike } from "../db/client";
import type { DeviceRow } from "../domain/rows";

export type Actor = "agent" | "user";

export interface Ctx {
  requestId: string;
  req: Request;
  now: Date;
  /** Who is calling. `anonymous` on public/pre-auth routes, `internal` for the cron token. */
  caller: Actor | "anonymous" | "internal";
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

/** Actor for `updated_by` / ChangeLog: agent, user, or system (cron, lazy close). */
export const writer = (ctx: Pick<Ctx, "caller">): "agent" | "user" | "system" =>
  ctx.caller === "agent" ? "agent" : ctx.caller === "user" ? "user" : "system";

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: Ctx, input: { params: any; query: any; body: any }) => Promise<HandlerResult>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const json = (status: number, body: unknown, headers?: Record<string, string>): HandlerResult => ({ status, body, headers });

/** Strong ETag from a version. */
export const etag = (version: number) => ({ ETag: `"${version}"` });

/** Expected version from `If-Match` or the body field; body wins when both are present. */
export const expectedVersion = (ctx: Ctx, bodyVersion?: number) => bodyVersion ?? ctx.ifMatch;

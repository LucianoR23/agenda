import type { ZodType } from "zod";

/** Who may call a route. Drives the OpenAPI `security`, `x-actors` and the automatic 401/403/429 responses. */
export type Access = "agent+user" | "user" | "agent" | "public" | "preauth" | "internal";

export type ExampleActor = "agent" | "user" | "anonymous" | "internal";

/** A paired request/response example. Validated against the route's schemas at generation time. */
export interface Exchange {
  name: string;
  summary: string;
  actor: ExampleActor;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  /** The request body is intentionally invalid (validation error examples). */
  invalidRequest?: boolean;
  status: number;
  response?: unknown;
  responseHeaders?: Record<string, string>;
}

export interface ResponseDef {
  description: string;
  /** Defaults to `Problem` for status >= 400; omit for empty bodies (204). */
  schema?: ZodType;
  headers?: Array<"ETag" | "Retry-After" | "Set-Cookie">;
}

export interface RouteDef {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  /** Accepts `If-Match` for optimistic concurrency. */
  ifMatch?: boolean;
  responses: Record<number, ResponseDef>;
  exchanges: Exchange[];
}

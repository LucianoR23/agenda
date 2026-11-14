import type { ZodObject, ZodType } from "zod";

/** API token permission. Mirrors the `token_scope` enum. */
export type TokenScope = "read" | "write" | "notify";

/** Who may call a route. Drives the OpenAPI `security`, `x-actors` and the automatic 401 responses. */
export type Access = "user" | "public" | "preauth";

export type ExampleActor = "user" | "anonymous";

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
  /** Defaults to the `Error` body for status >= 400; omit for empty bodies (204). */
  schema?: ZodType;
  headers?: Array<"ETag" | "Retry-After" | "Set-Cookie" | "Location">;
}

export interface RouteDef {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  /** API tokens may call this route when they hold this scope (Sunday operations). Session users always can. */
  token?: TokenScope;
  /** Path parameters: always an object schema (zod-to-openapi requires it). */
  params?: ZodObject;
  /** Query string: always an object schema. */
  query?: ZodObject;
  body?: ZodType;
  /** Accepts `If-Match` for optimistic concurrency. */
  ifMatch?: boolean;
  responses: Record<number, ResponseDef>;
  exchanges: Exchange[];
}

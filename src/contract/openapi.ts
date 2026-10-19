import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ZodType } from "zod";
import { Problem } from "./common";
import { dayEditedWithProposal } from "./examples";
import type { Access, Exchange, ResponseDef, RouteDef } from "./route-def";
import { planningRoutes } from "./routes/planning";
import { systemRoutes } from "./routes/system";
import { trackingRoutes } from "./routes/tracking";
import { WebhookPayload } from "./tracking";
import { z } from "./zod";

export const API_VERSION = "1.0.0";

export const routes: RouteDef[] = [...planningRoutes, ...trackingRoutes, ...systemRoutes];

const WRITE_METHODS = new Set(["post", "put", "patch"]);

const SECURITY: Record<Access, RouteConfig["security"]> = {
  "agent+user": [{ agentBearer: [] }, { session: [] }],
  agent: [{ agentBearer: [] }],
  user: [{ session: [] }],
  public: [],
  preauth: [],
  internal: [{ internalToken: [] }],
};

const ACTORS: Record<Access, string[]> = {
  "agent+user": ["agent", "user"],
  agent: ["agent"],
  user: ["user"],
  public: ["anyone"],
  preauth: ["anyone (device-key cookie)"],
  internal: ["internal"],
};

const HEADER_DOCS = {
  ETag: { description: 'Current `version` as a strong ETag, e.g. `"7"`.', schema: { type: "string" as const } },
  "Retry-After": { description: "Seconds to wait.", schema: { type: "integer" as const } },
  "Set-Cookie": { description: "`agenda_session` (httpOnly, Secure, SameSite=Lax).", schema: { type: "string" as const } },
};

const append = (base: ResponseDef | undefined, description: string, extra?: Partial<ResponseDef>): ResponseDef =>
  base
    ? { ...base, description: `${base.description} ${description}`, headers: [...(base.headers ?? []), ...(extra?.headers ?? [])] }
    : { description, ...extra };

/** Route responses plus the generic ones every route of that kind can produce. */
export function effectiveResponses(r: RouteDef): Record<number, ResponseDef> {
  const res: Record<number, ResponseDef> = { ...r.responses };
  if (r.params || r.query || r.body) res[400] = append(res[400], "`validation_error`.");
  if (r.access !== "public" && r.access !== "preauth")
    res[401] = append(res[401], r.access === "internal" ? "`unauthorized`: missing/invalid `X-Internal-Token`." : "`unauthorized` (no/invalid credentials) or `device_locked` (unlock with PIN).");
  if (r.access === "agent" || r.access === "user") res[403] = append(res[403], `\`forbidden\`: ${r.access} only.`);
  if (WRITE_METHODS.has(r.method)) {
    res[409] = append(res[409], "`idempotency_in_progress`.");
    res[422] = append(res[422], "`idempotency_key_reuse`: same `Idempotency-Key`, different body.");
  }
  if (r.access === "agent+user" || r.access === "agent")
    res[429] = append(res[429], "`rate_limited` (agent: 120 req/min).", { headers: ["Retry-After"] });
  return res;
}

const statusText: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 400: "Bad Request", 401: "Unauthorized",
  403: "Forbidden", 404: "Not Found", 409: "Conflict", 422: "Unprocessable Content", 429: "Too Many Requests", 503: "Service Unavailable",
};
export const reason = (s: number) => statusText[s] ?? "";

export function buildRegistry() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "agentBearer", {
    type: "http",
    scheme: "bearer",
    description: "Agenbot token (32 random bytes; the server stores only its SHA-256 in `AGENT_TOKEN_HASH`). Actor = `agent`.",
  });
  registry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "agenda_session",
    description: "Trusted-device session cookie. Actor = `user`.",
  });
  registry.registerComponent("securitySchemes", "internalToken", {
    type: "apiKey",
    in: "header",
    name: "X-Internal-Token",
    description: "Shared secret `INTERNAL_TOKEN` for the Coolify scheduled task.",
  });
  registry.registerComponent("securitySchemes", "agentWebhookToken", {
    type: "http",
    scheme: "bearer",
    description: "Outbound only: `AGENT_WEBHOOK_TOKEN`, sent by this app to Agenbot's webhook.",
  });

  const IdempotencyKey = registry.registerParameter(
    "IdempotencyKey",
    z.string().min(1).max(200).optional().openapi({
      param: { name: "Idempotency-Key", in: "header" },
      description: "Same key + same body → stored response replayed; different body → 422. Kept 48 h, scoped per actor.",
      example: "agenbot-2026-10-19-0700",
    }),
  );
  const IfMatch = registry.registerParameter(
    "IfMatch",
    z.string().optional().openapi({
      param: { name: "If-Match", in: "header" },
      description: 'Expected `version` as ETag (`"7"`). Mismatch → 409 `version_conflict` with the current resource.',
      example: '"7"',
    }),
  );

  registry.register("Problem", Problem);

  for (const r of routes) {
    const headers: ZodType[] = [];
    if (WRITE_METHODS.has(r.method)) headers.push(IdempotencyKey);
    if (r.ifMatch) headers.push(IfMatch);

    const bodyExamples = Object.fromEntries(
      r.exchanges.filter((e) => e.body !== undefined && !e.invalidRequest).map((e) => [e.name, { summary: e.summary, value: e.body }]),
    );

    const responses: RouteConfig["responses"] = {};
    for (const [statusStr, def] of Object.entries(effectiveResponses(r))) {
      const status = Number(statusStr);
      const schema = def.schema ?? (status >= 400 ? Problem : undefined);
      const exs = r.exchanges.filter((e) => e.status === status && e.response !== undefined);
      const mediaType = status >= 400 && !def.schema ? "application/problem+json" : "application/json";
      responses[status] = {
        description: def.description,
        ...(def.headers?.length
          ? { headers: Object.fromEntries([...new Set(def.headers)].map((h) => [h, HEADER_DOCS[h]])) }
          : {}),
        ...(schema
          ? {
              content: {
                [mediaType]: {
                  schema,
                  ...(exs.length
                    ? { examples: Object.fromEntries(exs.map((e) => [e.name, { summary: e.summary, value: e.response }])) }
                    : {}),
                },
              },
            }
          : {}),
      };
    }

    const config = {
      method: r.method,
      path: r.path,
      operationId: r.operationId,
      tags: [r.tag],
      summary: r.summary,
      description: [r.description, `**Actors:** ${ACTORS[r.access].join(", ")}.`].filter(Boolean).join("\n\n"),
      security: SECURITY[r.access],
      "x-actors": ACTORS[r.access],
      request: {
        ...(r.params ? { params: r.params } : {}),
        ...(r.query ? { query: r.query } : {}),
        ...(headers.length ? { headers } : {}),
        ...(r.body
          ? {
              body: {
                required: true,
                content: {
                  "application/json": {
                    schema: r.body,
                    ...(Object.keys(bodyExamples).length ? { examples: bodyExamples } : {}),
                  },
                },
              },
            }
          : {}),
      },
      responses,
    } as RouteConfig;
    registry.registerPath(config);
  }

  registry.registerWebhook({
    method: "post",
    path: "dayUpdatedByUser",
    operationId: "dayUpdatedByUser",
    tags: ["Webhook"],
    summary: "Outbound: my changes, sent to Agenbot",
    security: [{ agentWebhookToken: [] }],
    description: [
      "`POST ${AGENT_WEBHOOK_URL}` with `Authorization: Bearer ${AGENT_WEBHOOK_TOKEN}` and `Idempotency-Key: <batchId>`.",
      "Only changes made by me (never the agent's). Debounced per day: sent after `WEBHOOK_DEBOUNCE_SECONDS` (120) without new changes,",
      "or immediately for `choose` and proposal accept/reject. Retried with exponential backoff, 5 attempts. Any 2xx = delivered.",
    ].join(" "),
    request: {
      body: {
        content: {
          "application/json": {
            schema: WebhookPayload,
            examples: { afterCall: { summary: "Martín's call done + reading moved", value: webhookExample } },
          },
        },
      },
    },
    responses: { 200: { description: "Any 2xx acknowledges the batch." } },
  });

  return registry;
}

export const webhookExample = {
  event: "day.updated_by_user",
  batchId: "019a0a6e-1c00-7000-8000-000000000384",
  date: "2026-10-19",
  dayVersion: 4,
  changes: [
    {
      entity: "block",
      id: dayEditedWithProposal.options[0].blocks.find((b) => b.type === "call")!.id,
      action: "update",
      fields: { status: { from: "pending", to: "done" }, outcome: { from: null, to: "follow_up" }, note: { from: null, to: "Le interesa, pide hablar con la pareja. Volver a llamar el jueves 18:00." } },
      block: { title: "Llamada · Martín Gómez", type: "call", start: "10:00", externalId: "4f2k9q0d1m7b8s6t3u1v0a2c3e", outcome: "follow_up" },
      at: "2026-10-19T10:48:03.551-03:00",
    },
    {
      entity: "block",
      id: dayEditedWithProposal.options[0].blocks.find((b) => b.type === "reading")!.id,
      action: "update",
      fields: { start: { from: "11:00", to: "11:15" }, end: { from: "11:30", to: "11:45" } },
      block: { title: "Lectura (30 min)", type: "reading", start: "11:15", externalId: null },
      at: "2026-10-19T10:50:12.000-03:00",
    },
  ],
  summary: { blocksDone: 1, blocksTotal: 12, weeklyGym: { done: 0, target: 3 } },
  dayUrl: "https://agenda.lemydev.com/api/days/2026-10-19",
};

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(buildRegistry().definitions, { sortComponents: "alphabetically" });
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agenda API",
      version: API_VERSION,
      description: [
        "Personal day planner fed by Agenbot. Base path `/api`, JSON only, times in America/Buenos_Aires.",
        "",
        "- **Actors:** `agent` (Bearer token) and `user` (session cookie), derived from the auth method.",
        "- **Errors:** RFC 9457 `application/problem+json` with `code`, `errors[]` and `requestId`.",
        "- **Concurrency:** resources carry `version` + `ETag`; writes accept `If-Match` or `version` in the body.",
        "- **Idempotency:** `Idempotency-Key` on every POST/PUT/PATCH.",
        "- **Ownership:** calendar blocks belong to Google Calendar (agent mirrors them); schedule fields I edit (`userOverrides`), `locked` blocks and tracking fields I set belong to me.",
        "- Unknown fields are rejected everywhere.",
      ].join("\n"),
    },
    servers: [{ url: "https://agenda.lemydev.com" }, { url: "http://localhost:3000" }],
    tags: [
      { name: "Days" },
      { name: "Proposals" },
      { name: "Blocks" },
      { name: "Habits" },
      { name: "Tasks" },
      { name: "Metrics" },
      { name: "Agent" },
      { name: "Auth" },
      { name: "Push" },
      { name: "Ops" },
      { name: "Webhook" },
    ],
  });
}

/** Validates every example against the route schemas. Returns a list of human-readable failures. */
export function validateExamples(): string[] {
  const failures: string[] = [];
  const check = (where: string, schema: ZodType | undefined, value: unknown, expectValid = true) => {
    if (!schema) return;
    const res = schema.safeParse(value);
    if (res.success !== expectValid)
      failures.push(`${where}: ${expectValid ? res.error?.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") : "expected to be invalid"}`);
  };
  for (const r of routes) {
    const responses = effectiveResponses(r);
    const ops = new Set<string>();
    for (const e of r.exchanges) {
      const at = `${r.operationId}/${e.name}`;
      if (ops.has(e.name)) failures.push(`${at}: duplicate example name`);
      ops.add(e.name);
      check(`${at} params`, r.params, e.params ?? {});
      check(`${at} query`, r.query, e.query ?? {});
      if (e.body !== undefined && !r.body) failures.push(`${at}: body given but route has none`);
      if (r.body) check(`${at} body`, r.body, e.body, !e.invalidRequest);
      const def = responses[e.status];
      if (!def) {
        failures.push(`${at}: status ${e.status} not documented`);
        continue;
      }
      const schema = def.schema ?? (e.status >= 400 ? Problem : undefined);
      if (schema) check(`${at} response`, schema, e.response);
      else if (e.response !== undefined) failures.push(`${at}: ${e.status} has no body schema`);
    }
  }
  const wh = WebhookPayload.safeParse(webhookExample);
  if (!wh.success) failures.push(`webhook: ${wh.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return failures;
}

export type { Exchange };

/**
 * Removes `examples` (318 KB → 115 KB). `/api/openapi.json` serves this compact form by default so Agenbot
 * spends fewer tokens reading the contract; `?examples=true` returns the full document.
 */
export function withoutExamples<T>(doc: T): T {
  const strip = (o: unknown): unknown =>
    Array.isArray(o)
      ? o.map(strip)
      : o && typeof o === "object"
        ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "examples").map(([k, v]) => [k, strip(v)]))
        : o;
  return strip(doc) as T;
}

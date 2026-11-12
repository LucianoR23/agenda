import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import type { ZodType } from "zod";
import { Problem } from "./common";
import type { Access, Exchange, ResponseDef, RouteDef } from "./route-def";
import { systemRoutes } from "./routes/system";
import { z } from "./zod";

export const API_VERSION = "2.0.0-alpha";

export const routes: RouteDef[] = [...systemRoutes];

const WRITE_METHODS = new Set(["post", "put", "patch"]);

const SECURITY: Record<Access, RouteConfig["security"]> = {
  user: [{ session: [] }],
  public: [],
  preauth: [],
};

const ACTORS: Record<Access, string[]> = {
  user: ["user"],
  public: ["anyone"],
  preauth: ["anyone (device-key cookie)"],
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
    res[401] = append(res[401], "`unauthorized` (no/invalid credentials) or `device_locked` (unlock with PIN).");
  if (WRITE_METHODS.has(r.method)) {
    res[409] = append(res[409], "`idempotency_in_progress`.");
    res[422] = append(res[422], "`idempotency_key_reuse`: same `Idempotency-Key`, different body.");
  }
  return res;
}

export function buildRegistry() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "agenda_session",
    description: "Trusted-device session cookie. Actor = `user`.",
  });

  const IdempotencyKey = registry.registerParameter(
    "IdempotencyKey",
    z.string().min(1).max(200).optional().openapi({
      param: { name: "Idempotency-Key", in: "header" },
      description: "Same key + same body → stored response replayed; different body → 422. Kept 48 h, scoped per actor.",
      example: "019a0a6e-1c00-7000-8000-000000000001",
    }),
  );
  // registered only when a route uses it, so the spec has no unused components
  const IfMatch = routes.some((r) => r.ifMatch)
    ? registry.registerParameter(
    "IfMatch",
    z.string().optional().openapi({
      param: { name: "If-Match", in: "header" },
      description: 'Expected `version` as ETag (`"7"`). Mismatch → 409 `version_conflict` with the current resource.',
      example: '"7"',
    }),
  )
    : undefined;

  registry.register("Problem", Problem);

  for (const r of routes) {
    const headers: ZodType[] = [];
    if (WRITE_METHODS.has(r.method)) headers.push(IdempotencyKey);
    if (r.ifMatch && IfMatch) headers.push(IfMatch);

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

  return registry;
}

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(buildRegistry().definitions, { sortComponents: "alphabetically" });
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agenda API",
      version: API_VERSION,
      description: [
        "Agenda v2: personal tasks, reminders and events. Base path `/api`, JSON only, user timezone America/Buenos_Aires.",
        "",
        "- **Errors:** RFC 9457 `application/problem+json` with `code`, `errors[]` and `requestId`.",
        "- **Concurrency:** resources carry `version` + `ETag`; writes accept `If-Match` or `version` in the body.",
        "- **Idempotency:** `Idempotency-Key` on every POST/PUT/PATCH.",
        "- Unknown fields are rejected everywhere.",
      ].join("\n"),
    },
    servers: [{ url: "https://agenda.lemydev.com" }, { url: "http://localhost:3000" }],
    tags: [{ name: "Auth" }, { name: "Push" }, { name: "Ops" }],
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
  return failures;
}

export type { Exchange };

/**
 * Removes `examples`. `/api/openapi.json` serves this compact form by default; `?examples=true` returns the full document.
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

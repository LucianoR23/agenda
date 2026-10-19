import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { routes } from "@/contract/openapi";
import type { RouteDef } from "@/contract/route-def";
import { randomToken, safeEqual, sha256 } from "../auth/crypto";
import { DEVICE_KEY_COOKIE, parseCookies, SESSION_COOKIE, setCookie } from "../auth/cookies";
import { resolveSession, touchDevice } from "../auth/session";
import { getDb } from "../db/client";
import { env } from "../env";
import { now as clockNow } from "../time";
import type { Actor, Ctx, Handler, HandlerResult } from "./context";
import { ApiError, validation } from "./errors";
import { complete, release, reserve } from "./idempotency";
import { AGENT_LIMIT_PER_MINUTE, hit } from "./ratelimit";

type Compiled = { def: RouteDef; regex: RegExp; keys: string[]; literals: number };

const compiled: Compiled[] = routes
  .map((def) => {
    const keys: string[] = [];
    const pattern = def.path.replace(/\{(\w+)\}/g, (_, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    return { def, regex: new RegExp(`^${pattern}$`), keys, literals: def.path.split("/").filter((s) => s && !s.startsWith("{")).length };
  })
  // literal segments beat parameters: /blocks/reorder before /blocks/{id}
  .sort((a, b) => b.literals - a.literals);

let handlers: Record<string, Handler> = {};

/** Registers the operationId → implementation map (src/server/api). */
export function registerHandlers(map: Record<string, Handler>) {
  handlers = map;
}

export const implementedOperations = () => Object.keys(handlers);

const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH"]);

function match(method: string, pathname: string) {
  let pathMatched = false;
  for (const c of compiled) {
    const m = c.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (c.def.method.toUpperCase() !== method) continue;
    const params = Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return { route: c.def, params };
  }
  if (pathMatched) throw new ApiError(405, "method_not_allowed", `${method} is not allowed on ${pathname}.`);
  throw new ApiError(404, "not_found", `No route for ${method} ${pathname}.`);
}

const pointer = (prefix: string, path: PropertyKey[]) => prefix + path.map((p) => `/${String(p)}`).join("");

function parse(schema: ZodType | undefined, value: unknown, prefix: string, errors: Array<{ path: string; message: string }>) {
  if (!schema) return value;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  for (const i of r.error.issues) errors.push({ path: pointer(prefix, i.path) || "/", message: i.message });
  return undefined;
}

function parseIfMatch(h: string | null): number | null {
  if (!h) return null;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(h.trim());
  if (!m) throw validation([{ path: "header/If-Match", message: 'Expected "<version>"' }]);
  return Number(m[1]);
}

function respond(status: number, body: unknown, requestId: string, headers: Record<string, string> = {}, cookies: string[] = []) {
  const h = new Headers({ "X-Request-Id": requestId, "Cache-Control": "no-store", ...headers });
  for (const c of cookies) h.append("Set-Cookie", c);
  if (body === undefined || status === 204) return new Response(null, { status, headers: h });
  const isProblem = status >= 400 && typeof body === "object" && body !== null && "code" in body && "requestId" in body;
  h.set("Content-Type", isProblem ? "application/problem+json" : "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const pg = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = pg.code ?? pg.cause?.code;
  const constraint = pg.constraint_name ?? pg.cause?.constraint_name;
  if (code === "23505") return validation([{ path: "/", message: `Already exists (${constraint})` }]);
  if (code === "23514" || code === "23503") return validation([{ path: "/", message: `Violates ${constraint}` }]);
  console.error(err);
  return new ApiError(500, "internal_error", "Unexpected error.");
}

/** Entry point for every /api request (the catch-all route and the tests call this). */
export async function handle(req: Request): Promise<Response> {
  const requestId = `req_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const now = clockNow();
  const db = getDb();
  const cookies = parseCookies(req.headers.get("cookie"));
  const setCookies: string[] = [];
  let idem: { actor: Actor; key: string } | null = null;

  try {
    const { route, params } = match(method, url.pathname);

    // --- authentication ---
    const authz = req.headers.get("authorization");
    let caller: Ctx["caller"] = "anonymous";
    const session = await resolveSession(db, cookies[SESSION_COOKIE], now);

    if (route.access === "internal") {
      const token = req.headers.get("x-internal-token") ?? "";
      if (!safeEqual(token, env().INTERNAL_TOKEN)) throw new ApiError(401, "unauthorized", "Missing or invalid X-Internal-Token.");
      caller = "internal";
    } else if (route.access !== "public" && route.access !== "preauth") {
      if (authz) {
        const m = /^Bearer\s+(.+)$/i.exec(authz);
        if (!m || !safeEqual(sha256(m[1].trim()), env().AGENT_TOKEN_HASH)) throw new ApiError(401, "unauthorized", "Invalid agent token.");
        caller = "agent";
      } else if (session && !session.locked) {
        caller = "user";
        await touchDevice(db, session.device, now);
      } else if (session?.locked) {
        throw new ApiError(401, "device_locked", "Unlock with your PIN or fingerprint.");
      } else {
        throw new ApiError(401, "unauthorized", "Authentication required.");
      }
      if (route.access === "agent" && caller !== "agent") throw new ApiError(403, "forbidden", "Agent only.");
      if (route.access === "user" && caller !== "user") throw new ApiError(403, "forbidden", "User only.");
    }

    if (caller === "agent") {
      const wait = hit("agent", AGENT_LIMIT_PER_MINUTE, now.getTime());
      if (wait !== null) throw new ApiError(429, "rate_limited", "Agent rate limit: 120 requests per minute.", { retryAfterSeconds: wait }, { "Retry-After": String(wait) });
    }

    let deviceKey = cookies[DEVICE_KEY_COOKIE];
    if (!deviceKey && route.access === "preauth") {
      deviceKey = randomToken(16);
      setCookies.push(setCookie(DEVICE_KEY_COOKIE, deviceKey, 400 * 86_400));
    }

    // --- input ---
    const errors: Array<{ path: string; message: string }> = [];
    const parsedParams = parse(route.params, params, "params", errors);
    const parsedQuery = parse(route.query, Object.fromEntries(url.searchParams), "query", errors);
    let rawBody = "";
    let parsedBody: unknown = undefined;
    if (route.body) {
      rawBody = await req.text();
      let json: unknown;
      try {
        json = rawBody ? JSON.parse(rawBody) : undefined;
      } catch {
        throw validation([{ path: "/", message: "Body is not valid JSON" }]);
      }
      if (json === undefined) errors.push({ path: "/", message: "Body is required" });
      else parsedBody = parse(route.body, json, "", errors);
    }
    if (errors.length) throw validation(errors);
    const ifMatch = route.ifMatch ? parseIfMatch(req.headers.get("if-match")) : null;

    // --- idempotency (outside the request transaction so 4xx responses are stored too) ---
    const key = req.headers.get("idempotency-key");
    if (key && IDEMPOTENT_METHODS.has(method) && (caller === "agent" || caller === "user")) {
      const r = await reserve(db, caller, key, method, url.pathname + url.search, rawBody, now);
      if (r && "replay" in r) return respond(r.replay.status, r.replay.body ?? undefined, requestId, { "Idempotent-Replayed": "true" });
      idem = { actor: caller, key };
    }

    const handler = handlers[route.operationId];
    if (!handler) throw new ApiError(500, "internal_error", `${route.operationId} is not implemented.`);

    const afterCommit: Array<() => Promise<void>> = [];
    const result: HandlerResult = await db.transaction(async (tx) => {
        const ctx: Ctx = {
          requestId,
          req,
          now,
          caller,
          sessionDevice: session?.device ?? null,
          sessionLocked: session?.locked ?? false,
          deviceKey: deviceKey ?? "",
          ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null,
          userAgent: req.headers.get("user-agent"),
          ifMatch,
          setCookies,
          db: tx,
          afterCommit,
        };
        return handler(ctx, { params: parsedParams, query: parsedQuery, body: parsedBody });
    });

    if (idem) await complete(db, idem.actor, idem.key, result.status, result.body ?? null);
    for (const fn of afterCommit) await fn().catch((e) => console.error("afterCommit failed", e));
    return respond(result.status, result.body, requestId, result.headers, setCookies);
  } catch (err) {
    const e = toApiError(err);
    const body = e.toBody(requestId);
    if (idem) {
      if (e.status >= 500) await release(db, idem.actor, idem.key).catch(() => {});
      else await complete(db, idem.actor, idem.key, e.status, body).catch(() => {});
    }
    return respond(e.status, body, requestId, e.headers, setCookies);
  }
}

import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { routes } from "@/contract/openapi";
import type { RouteDef } from "@/contract/route-def";
import { DEVICE_KEY_COOKIE, parseCookies, SESSION_COOKIE, setCookie } from "../auth/cookies";
import { randomToken } from "../auth/crypto";
import { resolveSession, touchDevice } from "../auth/session";
import { authenticateToken } from "../auth/tokens";
import { getDb } from "../db/client";
import { userTimeZone } from "../domain/settings";
import { clock } from "../domain/time";
import { env } from "../env";
import { log } from "../log";
import type { Caller, Ctx, Handler, HandlerResult } from "./context";
import { ApiError, validation } from "./errors";
import { complete, release, reserve } from "./idempotency";
import { clientIp } from "./ip";

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
  // literal segments beat parameters: /items/reorder before /items/{id}
  .sort((a, b) => b.literals - a.literals);

let handlers: Record<string, Handler> = {};

/** Registers the operationId → implementation map (src/server/api). */
export function registerHandlers(map: Record<string, Handler>) {
  handlers = map;
}

export const implementedOperations = () => Object.keys(handlers);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH"]);

function match(method: string, pathname: string) {
  let pathMatched = false;
  for (const c of compiled) {
    const m = c.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (c.def.method.toUpperCase() !== method) continue;
    const params = Object.fromEntries(c.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")]));
    return { route: c.def, params };
  }
  if (pathMatched) throw new ApiError(405, "METHOD_NOT_ALLOWED", `${method} no está permitido en ${pathname}.`);
  throw new ApiError(404, "NOT_FOUND", `No existe la ruta ${method} ${pathname}.`);
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
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const pg = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = pg.code ?? pg.cause?.code;
  const constraint = pg.constraint_name ?? pg.cause?.constraint_name;
  if (code === "23505") return new ApiError(409, "CONFLICT", undefined, { constraint });
  if (code === "23514" || code === "23503" || code === "23001")
    return validation([{ path: "/", message: `Violates ${constraint ?? "a database constraint"}` }]);
  log.error("unhandled error", { err });
  return new ApiError(500, "INTERNAL_ERROR");
}

/**
 * CSRF defence for cookie-authenticated writes: the request must come from the app itself. Browsers always send
 * `Origin` on cross-origin and non-GET requests; `Sec-Fetch-Site` covers the rest. Tokens carry no cookies and are
 * exempt.
 */
function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === new URL(env().APP_ORIGIN).origin) return;
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  throw new ApiError(403, "ORIGIN_NOT_ALLOWED");
}

/** Resolves who is calling and enforces the route's access rule. */
async function authenticate(
  route: RouteDef,
  req: Request,
  session: Awaited<ReturnType<typeof resolveSession>>,
  now: Temporal.Instant,
  ip: string | null,
): Promise<Caller> {
  const db = getDb();
  const authz = req.headers.get("authorization");
  if (authz) {
    const m = /^Bearer\s+(\S+)$/i.exec(authz);
    const token = m?.[1] ? await authenticateToken(db, m[1], now, ip) : null;
    if (!token) throw new ApiError(401, "UNAUTHORIZED", "Token inválido, revocado o vencido.");
    if (route.access === "public") return { kind: "token", tokenId: token.id, name: token.name, scopes: token.scopes };
    if (!route.token) throw new ApiError(403, "FORBIDDEN", "Esta operación no está disponible para tokens de API.");
    if (!token.scopes.includes(route.token))
      throw new ApiError(403, "INSUFFICIENT_SCOPE", `El token necesita el permiso "${route.token}" para esta operación.`, {
        requiredScope: route.token,
      });
    return { kind: "token", tokenId: token.id, name: token.name, scopes: token.scopes };
  }
  if (route.access !== "user") return session && !session.locked ? { kind: "user", deviceId: session.device.id } : { kind: "anonymous" };
  if (session && !session.locked) {
    await touchDevice(db, session.device, now);
    return { kind: "user", deviceId: session.device.id };
  }
  if (session?.locked) throw new ApiError(401, "DEVICE_LOCKED");
  throw new ApiError(401, "UNAUTHORIZED");
}

/** Entry point for every /api request (the catch-all route and the tests call this). */
export async function handle(req: Request): Promise<Response> {
  const requestId = `req_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const now = clock().now(); // one reading per request; tests inject the clock
  const db = getDb();
  const cookies = parseCookies(req.headers.get("cookie"));
  const setCookies: string[] = [];
  const ip = clientIp(req.headers, env().TRUST_CF);
  let idem: { scope: string; key: string } | null = null;

  try {
    const { route, params } = match(method, url.pathname);

    const session = await resolveSession(db, cookies[SESSION_COOKIE], now);
    const caller = await authenticate(route, req, session, now, ip);
    if (WRITE_METHODS.has(method) && caller.kind !== "token") assertSameOrigin(req);

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
    let parsedBody: unknown;
    if (route.body) {
      const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE");
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
    if (key && IDEMPOTENT_METHODS.has(method) && caller.kind !== "anonymous") {
      const scope = caller.kind === "token" ? `token:${caller.tokenId}` : "session";
      const r = await reserve(db, scope, key, method, url.pathname + url.search, rawBody, now);
      if (r && "replay" in r) return respond(r.replay.status, r.replay.body ?? undefined, requestId, { "Idempotent-Replayed": "true" });
      idem = { scope, key };
    }

    const handler = handlers[route.operationId];
    if (!handler) throw new ApiError(500, "INTERNAL_ERROR", `${route.operationId} no está implementado.`);

    const tz = await userTimeZone(db);
    const afterCommit: Array<() => Promise<void>> = [];
    const result: HandlerResult = await db.transaction(async (tx) => {
      const ctx: Ctx = {
        requestId,
        req,
        now,
        caller,
        tz,
        sessionDevice: session?.device ?? null,
        sessionLocked: session?.locked ?? false,
        deviceKey: deviceKey ?? "",
        ip,
        userAgent: req.headers.get("user-agent"),
        ifMatch,
        setCookies,
        db: tx,
        afterCommit,
      };
      return handler(ctx, { params: parsedParams, query: parsedQuery, body: parsedBody });
    });

    if (idem) await complete(db, idem.scope, idem.key, result.status, result.body ?? null);
    for (const fn of afterCommit) await fn().catch((err) => log.error("afterCommit failed", { err, requestId }));
    return respond(result.status, result.body, requestId, result.headers, setCookies);
  } catch (err) {
    const e = toApiError(err);
    const body = e.toBody(requestId);
    if (idem) {
      if (e.status >= 500) await release(db, idem.scope, idem.key).catch(() => {});
      else await complete(db, idem.scope, idem.key, e.status, body).catch(() => {});
    }
    return respond(e.status, body, requestId, e.headers, setCookies);
  }
}

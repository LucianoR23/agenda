import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { handle } from "@/server/api";
import { tuning as lockoutTuning } from "@/server/auth/lockout";
import { getDb } from "@/server/db/client";
import { resetSettingsCache } from "@/server/domain/settings";
import { fixedClock, setClock } from "@/server/domain/time";
import { resetEnv } from "@/server/env";
import { resetRateLimits } from "@/server/http/ratelimit";
import { type PushPayload, type SendResult, setPushSender } from "@/server/push";
import { validateResponse } from "./contract";
import { SETUP_CODE } from "./env";

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  cookies: string[];
}

type As = "user" | "anon";

export interface Client {
  request<T = any>(
    method: string,
    path: string,
    opts?: { body?: unknown; headers?: Record<string, string>; raw?: string },
  ): Promise<Res<T>>;
  get<T = any>(path: string, headers?: Record<string, string>): Promise<Res<T>>;
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>;
  put<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>;
  patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>;
  del<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>;
  cookieJar: Map<string, string>;
}

/** HTTP-level client: builds a Request, runs it through the real router and checks the response against openapi.yaml. */
export function client(_as: As, jar = new Map<string, string>()): Client {
  async function request(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> | undefined; raw?: string } = {},
  ) {
    const headers: Record<string, string> = {
      "user-agent": "Mozilla/5.0 (Linux; Android 16; SM-S948B) Chrome/141.0 Mobile",
      // what a browser sends on the app's own requests (the router rejects cookie writes from other origins)
      origin: "https://agenda.lemydev.com",
      ...(opts.headers ?? {}),
    };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined) headers["content-type"] ??= "application/json";
    const res = await handle(
      new Request(`https://agenda.lemydev.com${path}`, { method, headers, ...(body === undefined ? {} : { body }) }),
    );
    const cookies = res.headers.getSetCookie();
    for (const c of cookies) {
      const [pair = "", ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = decodeURIComponent(pair.slice(i + 1));
      if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    validateResponse(method, new URL(`https://x${path}`).pathname, res.status, res.headers.get("content-type"), parsed);
    return { status: res.status, body: parsed, headers: res.headers, cookies };
  }
  return {
    request,
    get: (p, h) => request("GET", p, { headers: h }),
    post: (p, b, h) => request("POST", p, { body: b, headers: h }),
    put: (p, b, h) => request("PUT", p, { body: b, headers: h }),
    patch: (p, b, h) => request("PATCH", p, { body: b, headers: h }),
    del: (p, b, h) => request("DELETE", p, { body: b, headers: h }),
    cookieJar: jar,
  };
}

export const anon = (jar?: Map<string, string>) => client("anon", jar);

export const PIN = "482913";

/** Runs first-run setup and returns a logged-in user client (+ the recovery codes). */
export async function setupUser(pin = PIN) {
  const c = client("user");
  const r = await c.post("/api/auth/setup", { setupCode: SETUP_CODE, pin, deviceName: "Test phone" });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { user: c, recoveryCodes: r.body.recoveryCodes as string[], device: r.body.device };
}

/** Pushes "sent" during a test, with the endpoint and the send options. */
export const pushes: Array<PushPayload & { endpoint: string; ttl: number; urgency: string }> = [];
/** What the fake push service answers (tests override it to simulate failures). */
export const pushService: { reply: (endpoint: string) => SendResult } = { reply: () => ({ ok: true }) };

/** Clean slate between tests: empty tables, real clock at a fixed instant, captured pushes. */
export async function resetAll(at = "2026-10-19T06:55:00-03:00") {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(at);
  resetEnv();
  resetSettingsCache();
  lockoutTuning.globalDelayMs = 0;
  resetRateLimits();
  pushes.length = 0;
  pushService.reply = () => ({ ok: true });
  setPushSender(async (sub, payload, opts) => {
    const r = pushService.reply(sub.endpoint);
    if (r.ok) pushes.push({ ...payload, endpoint: sub.endpoint, ...opts });
    return r;
  });
  await resetDb();
}

/**
 * Empties every table (the guard already ensured this is a *_test database) and restores what migrations seed:
 * the Inbox list.
 */
export async function resetDb() {
  const db = getDb();
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  await db.execute(sql`INSERT INTO task_list (name, is_inbox, sort_order, updated_by) VALUES ('Inbox', true, 0, 'system')`);
}

/** Moves both clocks: the injectable one (Temporal, domain code) and Date (code not yet on Temporal). */
export function setNow(at: string) {
  const instant = Temporal.Instant.from(at);
  setClock(fixedClock(instant));
  vi.setSystemTime(instant.epochMilliseconds);
}

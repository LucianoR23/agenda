import { sql } from "drizzle-orm";
import { vi } from "vitest";
import { handle } from "@/server/api";
import { getDb } from "@/server/db/client";
import { resetEnv } from "@/server/env";
import { resetRateLimits } from "@/server/http/ratelimit";
import { setPushSender, type PushMessage } from "@/server/push";
import { validateResponse } from "./contract";
import { AGENT_TOKEN, INTERNAL_TOKEN, SETUP_CODE } from "./env";

export interface Res<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  body: T;
  headers: Headers;
  cookies: string[];
}

type As = "agent" | "user" | "anon" | "internal";

export interface Client {
  request<T = any>(method: string, path: string, opts?: { body?: unknown; headers?: Record<string, string>; raw?: string }): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  get<T = any>(path: string, headers?: Record<string, string>): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  put<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  del<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookieJar: Map<string, string>;
}

/** HTTP-level client: builds a Request, runs it through the real router and checks the response against openapi.yaml. */
export function client(as: As, jar = new Map<string, string>()): Client {
  async function request(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
    const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (Linux; Android 16; SM-S948B) Chrome/141.0 Mobile", ...(opts.headers ?? {}) };
    if (as === "agent") headers.authorization = `Bearer ${AGENT_TOKEN}`;
    if (as === "internal") headers["x-internal-token"] = INTERNAL_TOKEN;
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await handle(new Request(`https://agenda.lemydev.com${path}`, { method, headers, body }));
    const cookies = res.headers.getSetCookie();
    for (const c of cookies) {
      const [pair, ...attrs] = c.split(";");
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

export const agent = () => client("agent");
export const anon = (jar?: Map<string, string>) => client("anon", jar);
export const internal = () => client("internal");

export const PIN = "482913";

/** Runs first-run setup and returns a logged-in user client (+ the recovery codes). */
export async function setupUser(pin = PIN) {
  const c = client("user");
  const r = await c.post("/api/auth/setup", { setupCode: SETUP_CODE, pin, deviceName: "Test phone" });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { user: c, recoveryCodes: r.body.recoveryCodes as string[], device: r.body.device };
}

const TABLES = [
  "adjustment", "block", "plan_option", "proposal", "task", "habit_log", "habit", "sleep_log", "day", "change_log", "webhook_outbox",
  "idempotency_key", "notification_log", "push_subscription", "passkey", "auth_attempt", "auth_lockout", "device",
  "recovery_code", "pin_reset_code", "app_user",
];

export const pushes: PushMessage[] = [];

/** Clean slate between tests: empty tables, real clock at a fixed instant, captured pushes. */
export async function resetAll(at = "2026-10-19T06:55:00-03:00") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  resetEnv();
  resetRateLimits();
  pushes.length = 0;
  setPushSender(async (_sub, msg) => {
    pushes.push(msg);
    return { gone: false };
  });
  await getDb().execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

export const setNow = (at: string) => vi.setSystemTime(new Date(at));

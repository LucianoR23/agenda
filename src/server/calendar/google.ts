import { createHash } from "node:crypto";
import { z } from "zod";
import { randomToken } from "../auth/crypto";
import { env } from "../env";

/**
 * Google Calendar, read-only, over plain `fetch` (docs/v2/06): OAuth 2.0 with PKCE, token refresh and revocation,
 * `calendarList.list` and `events.list`. Responses are validated with Zod (loose objects: Google adds fields), so a
 * surprising answer fails with a clear error instead of bad data. Tests replace the transport with `setGoogleFetch`.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
export const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TIMEOUT_MS = 20_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let transport: Fetch = (url, init) => fetch(url, init);

/** Tests: route Google calls to a fake. `null` restores the network. */
export function setGoogleFetch(f: Fetch | null) {
  transport = f ?? ((url, init) => fetch(url, init));
  accessTokens.clear();
}

/**
 * What went wrong, in terms the sync can act on: `invalid_grant` → the connection is dead (reconnect);
 * `forbidden` → the Workspace admin blocks it (use iCal); `rate_limited` / `unavailable` → back off and retry.
 */
export type GoogleErrorKind = "invalid_grant" | "forbidden" | "not_found" | "rate_limited" | "unavailable" | "bad_response";

export class GoogleError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const googleConfigured = () => {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.ENCRYPTION_KEY);
};

export const redirectUri = () => new URL("/api/google/callback", env().APP_ORIGIN).toString();

function credentials() {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new GoogleError("unavailable", "Google Calendar no está configurado.");
  return { id: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET };
}

// ---------- OAuth ----------

/** PKCE pair (RFC 7636, S256). */
export function pkce() {
  const verifier = randomToken(48);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The consent URL: offline access (refresh token), consent every time (Google only returns it then), one scope. */
export function authorizeUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: credentials().id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q}`;
}

const TokenResponse = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await transport(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new GoogleError("unavailable", `No pude conectar con Google (${(err as Error).name}).`);
  }
}

async function errorFor(res: Response): Promise<GoogleError> {
  let body: { error?: string | { message?: string; errors?: Array<{ reason?: string }> } } = {};
  try {
    body = await res.json();
  } catch {}
  const err = body.error;
  const code = typeof err === "string" ? err : undefined;
  const reason = typeof err === "object" ? err.errors?.[0]?.reason : undefined;
  if (code === "invalid_grant" || res.status === 401)
    return new GoogleError("invalid_grant", "Google rechazó la conexión: hay que volver a conectar.", res.status);
  if (res.status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded")
    return new GoogleError("rate_limited", "Google pidió esperar (límite de pedidos).", res.status);
  if (res.status === 403) return new GoogleError("forbidden", "Google no permite el acceso (¿política del administrador?).", 403);
  if (res.status === 404) return new GoogleError("not_found", "Google no encontró ese calendario.", 404);
  if (res.status >= 500) return new GoogleError("unavailable", `Google no responde (HTTP ${res.status}).`, res.status);
  return new GoogleError("bad_response", `Respuesta inesperada de Google (HTTP ${res.status}${code ? `, ${code}` : ""}).`, res.status);
}

async function postForm(url: string, form: Record<string, string>) {
  return call(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new GoogleError("bad_response", `Respuesta inesperada de Google (${what}).`);
  return r.data;
}

/** Code → refresh token (the only thing stored, encrypted). */
export async function exchangeCode(code: string, verifier: string): Promise<{ refreshToken: string; scopes: string[] }> {
  const c = credentials();
  const res = await postForm(TOKEN_URL, {
    code,
    client_id: c.id,
    client_secret: c.secret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (!res.ok) throw await errorFor(res);
  const t = parse(TokenResponse, await res.json(), "token");
  if (!t.refresh_token) throw new GoogleError("bad_response", "Google no devolvió un refresh token. Probá conectar de nuevo.");
  const scopes = (t.scope ?? SCOPE).split(" ").filter(Boolean);
  if (!scopes.includes(SCOPE)) throw new GoogleError("forbidden", "No se otorgó el permiso de lectura del calendario.");
  cacheAccessToken(t.refresh_token, t.access_token, t.expires_in);
  return { refreshToken: t.refresh_token, scopes };
}

/** Access tokens live in memory only (1 h), keyed by a hash of the refresh token. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const keyOf = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex");

function cacheAccessToken(refreshToken: string, token: string, expiresIn: number) {
  // a minute early, so a token never expires mid-sync
  accessTokens.set(keyOf(refreshToken), { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
}

export async function accessToken(refreshToken: string): Promise<string> {
  const hit = accessTokens.get(keyOf(refreshToken));
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const c = credentials();
  const res = await postForm(TOKEN_URL, {
    client_id: c.id,
    client_secret: c.secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!res.ok) throw await errorFor(res);
  const t = parse(TokenResponse, await res.json(), "refresh");
  cacheAccessToken(refreshToken, t.access_token, t.expires_in);
  return t.access_token;
}

/** Best effort: Google forgets the grant. Failure doesn't block disconnecting locally. */
export async function revoke(refreshToken: string): Promise<boolean> {
  accessTokens.delete(keyOf(refreshToken));
  try {
    const res = await postForm(REVOKE_URL, { token: refreshToken });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Calendar API ----------

async function getJson(path: string, refreshToken: string, query: Record<string, string>): Promise<unknown> {
  const url = `${API}${path}?${new URLSearchParams(query)}`;
  const send = async () =>
    call(url, { headers: { Authorization: `Bearer ${await accessToken(refreshToken)}`, Accept: "application/json" } });
  let res = await send();
  if (res.status === 401) {
    // the cached access token died early: refresh once
    accessTokens.delete(keyOf(refreshToken));
    res = await send();
  }
  if (!res.ok) throw await errorFor(res);
  return res.json();
}

const CalendarListEntry = z.looseObject({
  id: z.string().min(1),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  backgroundColor: z.string().optional(),
  primary: z.boolean().optional(),
  selected: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
const CalendarListPage = z.looseObject({ items: z.array(CalendarListEntry).default([]), nextPageToken: z.string().optional() });

export interface GoogleCalendar {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  /** Shown in Google Calendar's own sidebar: a good default for "enabled". */
  selected: boolean;
}

export async function listCalendars(refreshToken: string): Promise<GoogleCalendar[]> {
  const out: GoogleCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const page = parse(
      CalendarListPage,
      await getJson("/users/me/calendarList", refreshToken, { maxResults: "250", ...(pageToken ? { pageToken } : {}) }),
      "calendarList",
    );
    for (const c of page.items) {
      if (c.deleted) continue;
      out.push({
        id: c.id,
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor ?? null,
        primary: c.primary ?? false,
        selected: c.selected ?? false,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

const When = z.looseObject({ date: z.string().optional(), dateTime: z.string().optional() });
const GoogleEvent = z.looseObject({
  id: z.string().min(1),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  etag: z.string().optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  updated: z.string().optional(),
  start: When.optional(),
  end: When.optional(),
});
const EventsPage = z.looseObject({ items: z.array(GoogleEvent).default([]), nextPageToken: z.string().optional() });
export type GoogleEvent = z.infer<typeof GoogleEvent>;

/** Every instance (recurring events expanded by Google) overlapping the window, cancelled ones included. */
export async function listEvents(
  refreshToken: string,
  calendarId: string,
  timeMin: Temporal.Instant,
  timeMax: Temporal.Instant,
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = parse(
      EventsPage,
      await getJson(`/calendars/${encodeURIComponent(calendarId)}/events`, refreshToken, {
        singleEvents: "true",
        showDeleted: "true",
        orderBy: "startTime",
        timeMin: timeMin.toString(),
        timeMax: timeMax.toString(),
        maxResults: "2500",
        ...(pageToken ? { pageToken } : {}),
      }),
      "events",
    );
    out.push(...page.items);
    pageToken = page.nextPageToken;
    if (++pages > 40) throw new GoogleError("bad_response", "Demasiadas páginas de eventos en Google.");
  } while (pageToken);
  return out;
}

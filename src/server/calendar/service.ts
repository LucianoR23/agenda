import { createHmac } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { clearCookie, parseCookies, setCookie } from "../auth/cookies";
import { randomToken, safeEqual, sign, unsign } from "../auth/crypto";
import { getDb } from "../db/client";
import { one } from "../db/one";
import { calendarSource, googleCredential, reminder } from "../db/schema";
import { recordChange } from "../domain/changes";
import { clearEventReminders, materializeEventReminders } from "../domain/event-reminders";
import { findExternal } from "../domain/events";
import { reminderOut } from "../domain/reminders";
import { formatInstant, fromDate, timeOf, toDate } from "../domain/time";
import { env } from "../env";
import { type Ctx, type HandlerResult, sourceOf } from "../http/context";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { authorizeUrl, exchangeCode, GoogleError, googleConfigured, listCalendars, PUSH_SCOPE, pkce, revoke } from "./google";
import { assertPublicHttps, fetchIcal, IcalError, parseIcal } from "./ical";
import { pushBacklog, pushToGoogle } from "./push";
import { canEncrypt, open, seal } from "./secretbox";
import { applyIncoming, forgetGoogle, refreshGoogleCalendars, syncCalendars, windowAround } from "./sync";

type SourceRow = typeof calendarSource.$inferSelect;

const SETTINGS_PATH = "/ajustes/calendario";
const STATE_COOKIE = "agenda_google";
const STATE_MINUTES = 10;

const stateKey = () => createHmac("sha256", env().SESSION_SECRET).update("agenda/google-oauth-state/v1").digest("base64url");

/** "lemy@empresa.com" → "l…@empresa.com" (display only). */
export const maskAccount = (id: string) => {
  const at = id.indexOf("@");
  return at > 0 ? `${id[0]}…${id.slice(at)}` : null;
};

function sourceOut(s: SourceRow, ctx: Pick<Ctx, "tz">) {
  return {
    id: s.id,
    kind: s.kind === "ical" ? ("ical" as const) : ("google" as const),
    name: s.name,
    color: s.color,
    enabled: s.enabled,
    reminderMinutes: s.reminderMinutes,
    lastSyncedAt: s.lastSyncedAt ? formatInstant(s.lastSyncedAt, ctx.tz) : null,
    lastError: s.lastError,
  };
}

export async function calendarStatus(ctx: Ctx) {
  const [cred] = await ctx.db.select().from(googleCredential).limit(1);
  const sources = await ctx.db.select().from(calendarSource).orderBy(asc(calendarSource.kind), asc(calendarSource.name));
  const copying = Boolean(cred?.pushEnabled);
  const backlog = copying ? await pushBacklog(ctx.db, ctx.now, ctx.tz) : { pending: 0, failed: 0, lastError: null };
  return {
    google: {
      configured: googleConfigured(),
      connected: Boolean(cred && !cred.invalidAt),
      needsReconnect: Boolean(cred?.invalidAt),
      accountHint: cred?.accountHint ?? null,
      copyEvents: { available: Boolean(cred?.scopes.includes(PUSH_SCOPE)), enabled: copying, ...backlog },
    },
    canAddIcal: canEncrypt(),
    sources: sources.map((s) => sourceOut(s, ctx)),
  };
}

async function findSource(ctx: Ctx, id: string) {
  const [s] = await ctx.db.select().from(calendarSource).where(eq(calendarSource.id, id));
  if (!s) throw notFound("No encontré ese calendario.");
  return s;
}

export async function updateCalendar(ctx: Ctx, id: string, b: { name?: string; enabled?: boolean; reminderMinutes?: number | null }) {
  const s = await findSource(ctx, id);
  const row = one(
    await ctx.db
      .update(calendarSource)
      .set({
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.reminderMinutes !== undefined ? { reminderMinutes: b.reminderMinutes } : {}),
      })
      .where(eq(calendarSource.id, id))
      .returning(),
    "calendar update",
  );
  if (row.reminderMinutes !== s.reminderMinutes || row.enabled !== s.enabled) {
    await clearEventReminders(ctx.db, { sourceId: id });
    if (row.enabled && row.reminderMinutes !== null) await materializeEventReminders(ctx.db, ctx.now, { sourceId: id });
  }
  return sourceOut(row, ctx);
}

export async function deleteCalendar(ctx: Ctx, id: string) {
  const s = await findSource(ctx, id);
  if (s.kind === "google")
    throw new ApiError(409, "CONFLICT", "Los calendarios de Google se ocultan (enabled: false) o se desconecta la cuenta entera.");
  await ctx.db.delete(calendarSource).where(eq(calendarSource.id, id)); // events and their reminders cascade
}

/** Plan B: a secret iCal address. Fetched and parsed before it's stored, so a bad address never gets saved. */
export async function addIcal(ctx: Ctx, b: { name: string; url: string }) {
  if (!canEncrypt()) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Falta configurar ENCRYPTION_KEY en el servidor.");
  const window = windowAround(ctx.now);
  let incoming: ReturnType<typeof parseIcal>;
  let url: URL;
  try {
    url = await assertPublicHttps(b.url);
    incoming = parseIcal(await fetchIcal(url.toString()), window.from, window.to);
  } catch (err) {
    if (err instanceof IcalError)
      throw new ApiError(400, "VALIDATION_ERROR", err.message, { fields: [{ path: "/url", message: "Invalid iCal address" }] });
    throw err;
  }
  const row = one(
    await ctx.db
      .insert(calendarSource)
      .values({
        kind: "ical",
        // the stored id is a hash: the URL itself is a secret and lives only encrypted
        externalCalendarId: createHmac("sha256", stateKey()).update(url.toString()).digest("hex").slice(0, 32),
        name: b.name,
        icalUrlEnc: seal(url.toString()),
        lastSyncedAt: toDate(ctx.now),
      })
      .returning(),
    "ical insert",
  );
  await applyIncoming(ctx.db, row.id, incoming, window, ctx.now, ctx.tz);
  return sourceOut(row, ctx);
}

/** "Sincronizar": everything now, or only if the last sync is older than `ifOlderThanSeconds` (app open). */
export async function syncNow(ctx: Ctx, b: { ifOlderThanSeconds?: number }) {
  if (b.ifOlderThanSeconds !== undefined) {
    const sources = await ctx.db.select({ at: calendarSource.lastSyncedAt }).from(calendarSource).where(eq(calendarSource.enabled, true));
    const stale = sources.some((s) => !s.at || fromDate(s.at).until(ctx.now).total("seconds") > (b.ifOlderThanSeconds as number));
    if (!stale) return calendarStatus(ctx);
  }
  // outside the request transaction: network calls, and each source's result commits on its own
  await syncCalendars(getDb(), ctx.now, { force: true });
  return calendarStatus(ctx);
}

// ---------- Google OAuth ----------

/** Conectar: PKCE + state in a signed, short-lived cookie, then off to Google. */
export function googleConnect(ctx: Ctx): HandlerResult {
  if (!googleConfigured())
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "Google Calendar no está configurado en el servidor (GOOGLE_CLIENT_ID/SECRET, ENCRYPTION_KEY).",
    );
  const state = randomToken(24);
  const { verifier, challenge } = pkce();
  const exp = ctx.now.add({ minutes: STATE_MINUTES }).epochMilliseconds;
  ctx.setCookies.push(setCookie(STATE_COOKIE, sign({ s: state, v: verifier, e: exp }, stateKey()), STATE_MINUTES * 60));
  return { status: 302, headers: { Location: authorizeUrl(state, challenge) } };
}

const back = (result: string): HandlerResult => ({
  status: 302,
  headers: { Location: `${SETTINGS_PATH}?google=${encodeURIComponent(result)}` },
});

/** Google's redirect back. Every outcome lands on Ajustes → Google Calendar with `?google=…`. */
export async function googleCallback(ctx: Ctx, q: { code?: string; state?: string; error?: string }): Promise<HandlerResult> {
  const cookie = parseCookies(ctx.req.headers.get("cookie"))[STATE_COOKIE];
  ctx.setCookies.push(clearCookie(STATE_COOKIE));
  if (q.error) return back(q.error.replace(/[^\w-]/g, "").slice(0, 40) || "error");
  const st = unsign<{ s?: string; v?: string; e?: number }>(cookie, stateKey());
  if (!st?.s || !st.v || !st.e || st.e < ctx.now.epochMilliseconds || !q.state || !safeEqual(st.s, q.state) || !q.code)
    return back("state");
  try {
    const { refreshToken, scopes } = await exchangeCode(q.code, st.v);
    const calendars = await listCalendars(refreshToken);
    const primary = calendars.find((c) => c.primary);
    const accountHint = primary ? maskAccount(primary.id) : null;
    // a reconnect (e.g. to grant the new permission) keeps "copy my events" and the "Agenda" calendar, same account only
    const [old] = await ctx.db.select().from(googleCredential).limit(1);
    const keep = old && old.accountHint === accountHint ? { pushEnabled: old.pushEnabled, agendaCalendarId: old.agendaCalendarId } : {};
    await ctx.db.delete(googleCredential);
    await ctx.db.insert(googleCredential).values({ refreshTokenEnc: seal(refreshToken), scopes, accountHint, ...keep });
    await refreshGoogleCalendars(ctx.db, refreshToken);
    log.info("google connected", { calendars: calendars.length });
    // first sync after the commit, without holding the redirect
    ctx.afterCommit.push(async () => {
      void syncCalendars(getDb(), ctx.now, { force: true }).catch((err) => log.error("first google sync failed", { err }));
    });
    return back("connected");
  } catch (err) {
    if (err instanceof GoogleError) {
      log.warn("google connect failed", { kind: err.kind, status: err.status });
      return back(err.kind);
    }
    throw err;
  }
}

/** Ajustes → "Copiar mis eventos a Google". Turning it on copies right away (after the commit). */
export async function updateGoogleSettings(ctx: Ctx, b: { copyEvents: boolean }) {
  const [cred] = await ctx.db.select().from(googleCredential).limit(1);
  if (b.copyEvents) {
    if (!cred || cred.invalidAt) throw new ApiError(409, "CONFLICT", "Conectá Google Calendar primero.");
    if (!cred.scopes.includes(PUSH_SCOPE))
      throw new ApiError(409, "CONFLICT", "Volvé a conectar Google para darle a Agenda permiso de crear su calendario.");
  }
  if (cred) {
    await ctx.db.update(googleCredential).set({ pushEnabled: b.copyEvents }).where(eq(googleCredential.id, cred.id));
    if (b.copyEvents)
      ctx.afterCommit.push(async () => {
        void pushToGoogle(getDb(), ctx.now).catch((err) => log.error("google push failed", { err }));
      });
  }
  return calendarStatus(ctx);
}

/** Desconectar: revoke at Google (best effort), then forget everything Google locally. */
export async function googleDisconnect(ctx: Ctx) {
  const [cred] = await ctx.db.select().from(googleCredential).limit(1);
  if (cred) await revoke(open(cred.refreshTokenEnc));
  await forgetGoogle(ctx.db);
}

// ---------- Recordarme ----------

export async function remindExternal(ctx: Ctx, id: string, b: { minutesBefore?: number; at?: string }) {
  const { e } = await findExternal(ctx, id);
  let fireAt: Temporal.Instant;
  let offset: number | null = null;
  let occurrence: Temporal.Instant | null = null;
  if (b.minutesBefore !== undefined) {
    if (e.allDay || !e.startsAt)
      throw new ApiError(400, "VALIDATION_ERROR", "Para un evento de todo el día elegí una hora (at).", {
        fields: [{ path: "/minutesBefore", message: "All-day events need `at`" }],
      });
    occurrence = fromDate(e.startsAt);
    offset = b.minutesBefore;
    fireAt = occurrence.subtract({ minutes: offset });
    const [dup] = await ctx.db
      .select({ id: reminder.id })
      .from(reminder)
      .where(
        and(
          eq(reminder.externalEventId, id),
          eq(reminder.offsetMinutes, offset),
          eq(reminder.eventOccurrenceAt, toDate(occurrence)),
          isNull(reminder.deletedAt),
        ),
      );
    if (dup) throw new ApiError(409, "CONFLICT", "Ya tenés ese recordatorio para este evento.");
  } else fireAt = Temporal.Instant.from(b.at as string);
  if (Temporal.Instant.compare(fireAt, ctx.now) <= 0)
    throw new ApiError(400, "VALIDATION_ERROR", "Ese momento ya pasó. Elegí uno futuro.", {
      fields: [{ path: b.at ? "/at" : "/minutesBefore", message: "Must be in the future" }],
    });
  const source = sourceOf(ctx.caller);
  const when = e.allDay ? "Todo el día" : e.startsAt ? `A las ${timeOf(fromDate(e.startsAt), ctx.tz)}` : "";
  const row = one(
    await ctx.db
      .insert(reminder)
      .values({
        title: e.title,
        body: e.location ? `${when} · ${e.location}` : when || null,
        fireAt: toDate(fireAt),
        externalEventId: id,
        offsetMinutes: offset,
        eventOccurrenceAt: occurrence ? toDate(occurrence) : null,
        source,
        updatedBy: source,
      })
      .returning(),
    "external reminder insert",
  );
  await recordChange(ctx, "reminder", row.id, "create");
  return reminderOut(row, ctx);
}

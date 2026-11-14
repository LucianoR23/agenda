import { and, count, eq, gte } from "drizzle-orm";
import { notificationLog } from "../db/schema";
import { env } from "../env";
import { type Ctx, sourceOf, tokenIdOf } from "../http/context";
import { ApiError } from "../http/errors";
import { sendNotice } from "../push";
import { addDays, instantText, toDate, weekdayName, weekStart, zoned } from "./time";

/** What Sunday needs to resolve "mañana" or "el viernes": the user's clock. */
export function now(ctx: Ctx) {
  const z = zoned(ctx.now, ctx.tz);
  const date = z.toPlainDate().toString();
  const monday = weekStart(date);
  return {
    now: z.toString({ timeZoneName: "never", smallestUnit: "millisecond" }),
    date,
    time: z.toPlainTime().toString({ smallestUnit: "minute" }),
    weekday: weekdayName(date),
    whenText: instantText(ctx.now, ctx.tz),
    timezone: ctx.tz,
    utcOffset: z.offset,
    tomorrow: addDays(date, 1),
    weekStart: monday,
    weekEnd: addDays(monday, 6),
  };
}

/** Pushes from Sunday per rolling 24 hours (notification_log, so a restart doesn't reset it). */
export const NOTIFY_DAILY_LIMIT = 20;

/** Sites a notification may open: the app itself and the CORS origins (Sunday). */
function allowedUrl(url: string | undefined): string {
  if (!url) return "/";
  if (/^\/(?!\/)/.test(url)) return url;
  const e = env();
  const hosts = new Set([new URL(e.APP_ORIGIN).host, ...e.CORS_ALLOWED_ORIGINS.map((o) => new URL(o).host)]);
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {}
  if (u && u.protocol === "https:" && hosts.has(u.host)) return u.toString();
  throw new ApiError(
    400,
    "VALIDATION_ERROR",
    "El link tiene que ser https en sunday.lemydev.com o agenda.lemydev.com, o una ruta de la app como /tareas.",
    { fields: [{ path: "/url", message: "Host not allowed" }] },
  );
}

export async function notify(ctx: Ctx, b: { title: string; body: string; url?: string; tag?: string }) {
  const url = allowedUrl(b.url);
  const source = sourceOf(ctx.caller);
  const since = ctx.now.subtract({ hours: 24 });
  const [sent] = await ctx.db
    .select({ n: count() })
    .from(notificationLog)
    .where(and(eq(notificationLog.kind, "notice"), eq(notificationLog.source, source), gte(notificationLog.createdAt, toDate(since))));
  const used = sent?.n ?? 0;
  if (used >= NOTIFY_DAILY_LIMIT) {
    const [oldest] = await ctx.db
      .select({ at: notificationLog.createdAt })
      .from(notificationLog)
      .where(and(eq(notificationLog.kind, "notice"), eq(notificationLog.source, source), gte(notificationLog.createdAt, toDate(since))))
      .orderBy(notificationLog.createdAt)
      .limit(1);
    const wait = oldest ? Math.max(60, Math.ceil((oldest.at.getTime() + 86_400_000 - ctx.now.epochMilliseconds) / 1000)) : 3600;
    throw new ApiError(
      429,
      "RATE_LIMITED",
      `Ya mandé ${NOTIFY_DAILY_LIMIT} notificaciones en las últimas 24 horas. Para algo más tarde usá createReminder.`,
      { retryAfterSeconds: wait },
      { "Retry-After": String(wait) },
    );
  }
  const r = await sendNotice(
    ctx.db,
    { title: b.title, body: b.body, url, ...(b.tag ? { tag: b.tag } : {}) },
    { source, tokenId: tokenIdOf(ctx.caller), at: ctx.now },
  );
  return { delivered: r.ok, failed: r.failed, remainingToday: NOTIFY_DAILY_LIMIT - used - 1 };
}

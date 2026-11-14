"use client";

import { useEffect, useState } from "react";
import { addDays, DEFAULT_TIMEZONE, dateOf, dayOfWeek, type IsoDate, systemClock, timeOf, today } from "@/server/domain/time";

/**
 * Client twin of `server/domain/time.ts`: the same pure Temporal helpers plus UI labels. `ensureTemporal()` runs
 * before the app renders (AppShell) and loads the polyfill only in browsers without native Temporal.
 */
export { addDays, DEFAULT_TIMEZONE, dateOf, type IsoDate, timeOf, today };

/** Installs temporal-polyfill when `Temporal` is missing (no-op, and no download, where it's native). */
export async function ensureTemporal() {
  if (typeof globalThis.Temporal === "undefined") await import("temporal-polyfill/global");
}

const TZ_KEY = "agenda:tz";
let currentTz: string | null = null;

/** The user's timezone (app_user.timezone, delivered with the session; remembered for offline starts). */
export function userTimeZone(): string {
  if (currentTz) return currentTz;
  try {
    currentTz = localStorage.getItem(TZ_KEY);
  } catch {}
  return currentTz ?? DEFAULT_TIMEZONE;
}

/** Called by the auth gate whenever the session (and so the timezone) loads or changes. */
export function setUserTimeZone(tz: string) {
  currentTz = tz;
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {}
}

/** Today in the user's timezone, whatever the device's own zone. */
export const todayLocal = (tz = userTimeZone()) => today(tz, systemClock);

const DOW = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DOW_SHORT = ["L", "M", "M", "J", "V", "S", "D"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "Lunes 19" / "Hoy · Lunes 19" / "Ayer · …" / "Mañana · …". */
export function dayLabel(date: IsoDate, base: IsoDate = todayLocal()) {
  const d = Temporal.PlainDate.from(date);
  const label = `${DOW[d.dayOfWeek - 1]} ${d.day}`;
  if (date === base) return `Hoy · ${label}`;
  if (date === addDays(base, -1)) return `Ayer · ${label}`;
  if (date === addDays(base, 1)) return `Mañana · ${label}`;
  return label;
}

/** An instant as "Hoy 09:00", "Mañana 08:30", "Jueves 19 10:00" in the user's timezone. */
export function whenLabel(iso: string, base: IsoDate = todayLocal()) {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(userTimeZone());
  const day = dayLabel(z.toPlainDate().toString(), base).replace(/ · .*/, "");
  return `${day} ${z.toPlainTime().toString({ smallestUnit: "minute" })}`;
}

/** "noviembre 2026". */
export const monthLabel = (date: IsoDate) => {
  const d = Temporal.PlainDate.from(date);
  return `${MONTHS[d.month - 1]} ${d.year}`;
};

/** "L", "M", … "D". */
export const shortDow = (date: IsoDate) => DOW_SHORT[dayOfWeek(date) - 1] ?? "";

/** "hoy 17:31", "ayer 09:10", "12/10 20:00" for an ISO instant, in the user's timezone. */
export function seenLabel(iso: string, tz = userTimeZone(), base: IsoDate = todayLocal(tz)) {
  const at = Temporal.Instant.from(iso);
  const day = dateOf(at, tz);
  const when = day === base ? "hoy" : day === addDays(base, -1) ? "ayer" : `${day.slice(8)}/${day.slice(5, 7)}`;
  return `${when} ${timeOf(at, tz)}`;
}

/** Re-renders every `ms` (live clocks, time-dependent cards). */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => Temporal.Now.instant());
  useEffect(() => {
    const t = setInterval(() => setNow(Temporal.Now.instant()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Short vibration on supported devices (swipe thresholds, toggles). */
export const haptic = (ms = 12) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

/** "hace 3 min", "hace 2 h" from epoch milliseconds. */
export function ago(ts: number | null, nowMs = Temporal.Now.instant().epochMilliseconds) {
  if (!ts) return "nunca";
  const s = Math.round((nowMs - ts) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86_400)} d`;
}

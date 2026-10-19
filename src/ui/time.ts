"use client";

import { useEffect, useState } from "react";

const TZ = "America/Buenos_Aires";

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );

/** Local date `YYYY-MM-DD` in Buenos Aires, whatever the device time zone. */
export const todayART = (d = new Date()) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

/** Local `HH:mm` in Buenos Aires. */
export const nowHHmm = (d = new Date()) => {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
};

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "Lunes 19" / "Hoy · Lunes 19". */
export function dayLabel(date: string, today = todayART()) {
  const d = new Date(`${date}T12:00:00Z`);
  const base = `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`;
  if (date === today) return `Hoy · ${base}`;
  if (date === addDays(today, -1)) return `Ayer · ${base}`;
  if (date === addDays(today, 1)) return `Mañana · ${base}`;
  return base;
}

export const monthLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const shortDow = (date: string) => ["D", "L", "M", "M", "J", "V", "S"][new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Re-renders every `ms` with the current time (the "now" line, the 22:00 review card). */
export function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
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

/** "hace 3 min", "hace 2 h". */
export function ago(ts: number | null, now = Date.now()) {
  if (!ts) return "nunca";
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86_400)} d`;
}

/**
 * Habit periods and streaks (pure). Weeks are Monday–Sunday (D47).
 * A period is met when: daily → the day's log is done (numeric: value ≥ target);
 * weekly → days done (boolean) or the sum of values (numeric) reaches the target.
 * The current period never breaks a streak until it ends.
 */
import { addDays, weekStart } from "../time";

export interface HabitDef {
  kind: "boolean" | "numeric";
  targetCount: number;
  targetPeriod: "day" | "week";
}
export interface LogPoint {
  date: string;
  done: boolean;
  value: number | null;
}

export const periodStart = (h: HabitDef, date: string) => (h.targetPeriod === "day" ? date : weekStart(date));
export const periodEnd = (h: HabitDef, date: string) => (h.targetPeriod === "day" ? date : addDays(weekStart(date), 6));
const prevPeriod = (h: HabitDef, start: string) => addDays(start, h.targetPeriod === "day" ? -1 : -7);

/** Amount counted towards the target for one log. */
const amount = (h: HabitDef, l: LogPoint) => (h.kind === "numeric" ? (l.value ?? 0) : l.done ? 1 : 0);

export function periodCount(h: HabitDef, logs: LogPoint[], start: string): number {
  const end = periodEnd(h, start);
  return logs.filter((l) => l.date >= start && l.date <= end).reduce((s, l) => s + amount(h, l), 0);
}

export function periodMet(h: HabitDef, logs: LogPoint[], start: string): boolean {
  if (h.targetPeriod === "day" && h.kind === "boolean") return logs.some((l) => l.date === start && l.done);
  return periodCount(h, logs, start) >= h.targetCount;
}

export function streaks(h: HabitDef, logs: LogPoint[], today: string): { current: number; best: number } {
  const curStart = periodStart(h, today);
  let current = periodMet(h, logs, curStart) ? 1 : 0;
  let p = prevPeriod(h, curStart);
  while (periodMet(h, logs, p)) {
    current++;
    p = prevPeriod(h, p);
  }

  const first = logs.reduce<string | null>((m, l) => (m === null || l.date < m ? l.date : m), null);
  let best = current;
  if (first) {
    let run = 0;
    for (let s = periodStart(h, first); s <= curStart; s = addDays(s, h.targetPeriod === "day" ? 1 : 7)) {
      if (periodMet(h, logs, s)) best = Math.max(best, ++run);
      else if (s !== curStart) run = 0;
    }
  }
  return { current, best };
}

/** Met / total periods that overlap [from, to] (the running period counts only when met). */
export function periodsInRange(h: HabitDef, logs: LogPoint[], from: string, to: string, today: string) {
  let met = 0;
  let total = 0;
  for (let s = periodStart(h, from); s <= to; s = addDays(s, h.targetPeriod === "day" ? 1 : 7)) {
    const ok = periodMet(h, logs, s);
    const running = s === periodStart(h, today);
    if (s > today) break;
    if (ok) met++;
    if (ok || !running) total++;
  }
  return { met, total };
}

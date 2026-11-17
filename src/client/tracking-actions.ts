"use client";

import { useQueryClient } from "@tanstack/react-query";
import { enqueue } from "./sync";
import type { HabitProgress } from "./types";

const keys = (...k: string[]) => k.map((x) => JSON.stringify([x]));
const REFRESH_HABITS = keys("habits", "summary", "history", "metrics");
const REFRESH_SLEEP = keys("sleep", "summary", "history", "metrics");

/** Habit checks and sleep: through the outbox, so they work offline (habit checks show up right away). */
export function useTrackingActions() {
  const qc = useQueryClient();
  return {
    /** Yes/no: check or uncheck. Numeric: the day's value (0 clears). */
    logHabit(h: HabitProgress, date: string, input: { done?: boolean; value?: number | null }) {
      const done = h.kind === "numeric" ? (input.value ?? 0) > 0 : (input.done ?? true);
      const value = h.kind === "numeric" ? (input.value ?? null) : null;
      void enqueue(qc, {
        method: "POST",
        path: `/api/habits/${h.id}/log`,
        body: h.kind === "numeric" ? { date, value } : { date, done },
        invalidate: REFRESH_HABITS,
        optimistic: { kind: "habit-log", habitId: h.id, date, done, value },
        label: h.name,
      });
    },

    sleepEvent(type: "bed" | "wake", at?: string) {
      void enqueue(qc, {
        method: "POST",
        path: "/api/sleep/events",
        body: at ? { type, at } : { type },
        invalidate: REFRESH_SLEEP,
        label: type === "bed" ? "Me voy a dormir" : "Me levanté",
      });
    },

    saveSleep(date: string, body: { bedAt?: string | null; wakeAt?: string | null; quality?: number | null; notes?: string | null }) {
      void enqueue(qc, { method: "PUT", path: `/api/sleep/${date}`, body, invalidate: REFRESH_SLEEP, label: "Sueño" });
    },
  };
}

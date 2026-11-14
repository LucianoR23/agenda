import type { HabitProgress, HabitQuery } from "./types";

type Log = { habitId: string; date: string; done: boolean; value: number | null };

/**
 * Client mirror of a habit check for the cached `["habits", query]` lists: the day's log and the period's count
 * move right away; streaks catch up when the server answers.
 */
export function applyHabitLog(list: HabitProgress[], q: HabitQuery, o: Log, today: string): HabitProgress[] {
  if ((q.date ?? today) !== o.date) {
    // another day of the same period still changes the period's count (its previous value is unknown here)
    return list;
  }
  return list.map((h) => {
    if (h.id !== o.habitId) return h;
    const log = o.done
      ? {
          ...(h.log ?? {
            id: `pending-${o.habitId}-${o.date}`,
            habitId: o.habitId,
            source: "user" as const,
            version: 1,
            createdAt: "",
            updatedAt: "",
            updatedBy: "user" as const,
          }),
          date: o.date,
          done: true,
          value: o.value,
        }
      : null;
    const amount = (done: boolean, value: number | null) => (h.kind === "numeric" ? (value ?? 0) : done ? 1 : 0);
    const prev = h.log ? amount(h.log.done, h.log.value) : 0;
    const count = Math.max(0, h.period.count - prev + amount(o.done, o.value));
    return { ...h, log, period: { ...h.period, count, met: count >= h.period.target } };
  });
}

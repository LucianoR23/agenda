import type { Reminder, ReminderQuery } from "./types";

const RECENT = new Set(["sent", "done", "missed", "cancelled"]);

/** Client mirror of the server's reminder views (see task-cache.ts for the idea). */
export function matchesReminder(r: Reminder, q: ReminderQuery): boolean {
  if (q.status && r.status !== q.status) return false;
  if (q.from && Temporal.Instant.compare(Temporal.Instant.from(r.fireAt), Temporal.Instant.from(q.from)) < 0) return false;
  if (q.to && Temporal.Instant.compare(Temporal.Instant.from(r.fireAt), Temporal.Instant.from(q.to)) > 0) return false;
  if (q.view === "upcoming") return r.status === "scheduled";
  if (q.view === "recent") return RECENT.has(r.status);
  return true;
}

const byFireAt = (a: Reminder, b: Reminder) => Temporal.Instant.compare(Temporal.Instant.from(a.fireAt), Temporal.Instant.from(b.fireAt));

export function putReminder(list: Reminder[], r: Reminder, q: ReminderQuery): Reminder[] {
  const rest = list.filter((x) => x.id !== r.id);
  if (!matchesReminder(r, q)) return rest;
  const out = [...rest, r].sort(byFireAt);
  return q.view === "recent" ? out.reverse() : out;
}

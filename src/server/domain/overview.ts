import type { Ctx } from "../http/context";
import { validation } from "../http/errors";
import { eventsBetween, rangeOf } from "./events";
import { remindersBetween } from "./reminders";
import { listTasks } from "./tasks";
import { addDays, daysBetween, type IsoDate, today } from "./time";

const MAX_DAYS = 31;

/**
 * getAgendaOverview: everything in a date range, the question "¿qué tengo hoy/mañana/esta semana?". Events (local +
 * Google/iCal), open tasks due in the range, reminders firing in it, and open tasks overdue before it.
 */
export async function overview(ctx: Ctx, q: { from?: IsoDate; to?: IsoDate }) {
  const from = q.from ?? today(ctx.tz, { now: () => ctx.now });
  const to = q.to ?? from;
  if (to < from) throw validation([{ path: "query/to", message: "Must not be before from" }]);
  if (daysBetween(from, to) > MAX_DAYS) throw validation([{ path: "query/to", message: `At most ${MAX_DAYS} days after from` }]);
  const { start, end } = rangeOf(from, to, ctx.tz);
  const byDue = <T extends { dueDate: string | null; dueTime: string | null }>(a: T, b: T) =>
    `${a.dueDate} ${a.dueTime ?? "99"}`.localeCompare(`${b.dueDate} ${b.dueTime ?? "99"}`);
  const [events, tasks, overdue, reminders] = [
    await eventsBetween(ctx, from, to),
    (await listTasks(ctx, { status: "open", dueFrom: from, dueTo: to, limit: 500 })).sort(byDue),
    (await listTasks(ctx, { status: "open", dueTo: addDays(from, -1), limit: 200 })).sort(byDue),
    (await remindersBetween(ctx, start, end.subtract({ milliseconds: 1 }))).filter((r) => r.status !== "cancelled"),
  ];
  return { from, to, events, tasks, reminders, overdue };
}

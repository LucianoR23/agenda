import type { z } from "zod";
import type { Block, HabitLog, Task } from "@/contract/planning";
import type { SleepLog } from "@/contract/sleep";
import { isoLocal, isoLocalOrNull, instantAt, toMinutes } from "../time";
import type { BlockRow, HabitLogRow, OptionRow, SleepRow, TaskRow } from "./rows";

const mutable = (r: { version: number; createdAt: Date; updatedAt: Date; updatedBy: "agent" | "user" | "system" }) => ({
  version: r.version,
  createdAt: isoLocal(r.createdAt),
  updatedAt: isoLocal(r.updatedAt),
  updatedBy: r.updatedBy,
});

export const byStart = (a: { start: string; order: number }, b: { start: string; order: number }) =>
  a.start.localeCompare(b.start) || a.order - b.order;

export function blockOut(b: BlockRow): z.infer<typeof Block> {
  return {
    id: b.id,
    optionId: b.optionId,
    start: b.start,
    end: b.end,
    title: b.title,
    type: b.type,
    callKind: b.callKind,
    detail: b.detail,
    lead: b.lead ?? null,
    source: b.source,
    externalId: b.externalId,
    externalUrl: b.externalUrl,
    calendar: b.calendar,
    removedFromCalendarAt: isoLocalOrNull(b.removedFromCalendarAt),
    status: b.status,
    statusAt: isoLocalOrNull(b.statusAt),
    outcome: b.outcome,
    note: b.note,
    locked: b.locked,
    remind: b.remind,
    userOverrides: b.userOverrides,
    order: b.order,
    ...mutable(b),
  };
}

export function optionOut(o: OptionRow, blocks: BlockRow[]) {
  return {
    id: o.id,
    label: o.label,
    title: o.title,
    description: o.description,
    order: o.order,
    blocks: blocks.filter((b) => b.optionId === o.id).sort(byStart).map(blockOut),
    ...mutable(o),
  };
}

export function taskOut(t: TaskRow): z.infer<typeof Task> {
  return {
    id: t.id,
    date: t.date,
    title: t.title,
    kind: t.kind,
    origin: t.origin,
    done: t.done,
    doneAt: isoLocalOrNull(t.doneAt),
    relatedBlockId: t.relatedBlockId,
    order: t.order,
    ...mutable(t),
  };
}

export function habitLogOut(l: HabitLogRow, slug: string): z.infer<typeof HabitLog> {
  return {
    id: l.id,
    habitId: l.habitId,
    habitSlug: slug,
    date: l.date,
    done: l.done,
    value: l.value === null ? null : Number(l.value),
    source: l.source,
    ...mutable(l),
  };
}

/** Sleep log with derived duration and delay vs the planned `sleep` block. */
export function sleepOut(s: SleepRow, planned: { start: string; end: string | null } | null): z.infer<typeof SleepLog> {
  const duration = s.bedAt && s.wokeAt ? Math.round((s.wokeAt.getTime() - s.bedAt.getTime()) / 60_000) : null;
  const delay = s.bedAt && planned ? Math.round((s.bedAt.getTime() - instantAt(s.date, planned.start).getTime()) / 60_000) : null;
  return {
    id: s.id,
    date: s.date,
    bedAt: isoLocalOrNull(s.bedAt),
    bedSource: s.bedSource,
    wokeAt: isoLocalOrNull(s.wokeAt),
    wakeSource: s.wakeSource,
    durationMinutes: duration,
    plannedStart: planned?.start ?? null,
    plannedEnd: planned?.end ?? null,
    bedDelayMinutes: delay,
    note: s.note,
    ...mutable(s),
  };
}

export const minutesOf = toMinutes;

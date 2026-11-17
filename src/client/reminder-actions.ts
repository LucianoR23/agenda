"use client";

import { useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { userTimeZone } from "@/ui/time";
import { enqueue } from "./sync";
import type { Reminder } from "./types";

const REFRESH = [JSON.stringify(["reminders"]), JSON.stringify(["tasks"])];

/** An ISO instant with the user's offset, like the server writes them. */
export const isoInZone = (i: Temporal.Instant) =>
  i.toZonedDateTimeISO(userTimeZone()).toString({ timeZoneName: "never", smallestUnit: "millisecond" });

/** Local date + time (user's zone) → ISO instant. */
export const localToIso = (date: string, time: string) =>
  isoInZone(
    Temporal.PlainDate.from(date)
      .toPlainDateTime(Temporal.PlainTime.from(time))
      .toZonedDateTime(userTimeZone(), { disambiguation: "compatible" })
      .toInstant(),
  );

export interface NewReminder {
  title: string;
  body?: string | null;
  fireAt: string;
  rrule?: string | null;
  urgent?: boolean;
  taskId?: string | null;
}

/** Reminder writes: optimistic, through the outbox (offline-safe), like tasks. */
export function useReminderActions() {
  const qc = useQueryClient();
  const put = (reminder: Reminder, method: "POST" | "PATCH" | "DELETE", path: string, body: unknown, label: string) =>
    void enqueue(qc, { method, path, body, invalidate: REFRESH, optimistic: { kind: "reminder-put", reminder }, label });

  return {
    create(input: NewReminder) {
      const id = uuidv7();
      const at = isoInZone(Temporal.Now.instant());
      const reminder: Reminder = {
        id,
        title: input.title,
        body: input.body ?? null,
        fireAt: input.fireAt,
        whenText: null,
        rrule: input.rrule ?? null,
        status: "scheduled",
        urgent: input.urgent ?? false,
        taskId: input.taskId ?? null,
        eventId: null,
        externalEventId: null,
        snoozedFrom: null,
        lastFiredAt: null,
        source: "user",
        url: "",
        version: 1,
        createdAt: at,
        updatedAt: at,
        updatedBy: "user",
      };
      const body = Object.fromEntries(Object.entries({ id, ...input }).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      put(reminder, "POST", "/api/reminders", body, "Recordatorio nuevo");
      return reminder;
    },

    update(r: Reminder, patch: Partial<NewReminder>) {
      const next: Reminder = {
        ...r,
        ...patch,
        body: patch.body !== undefined ? patch.body : r.body,
        rrule: patch.rrule !== undefined ? patch.rrule : r.rrule,
        taskId: patch.taskId !== undefined ? patch.taskId : r.taskId,
        ...(patch.fireAt ? { status: "scheduled" as const, snoozedFrom: null } : {}),
        version: r.version + 1,
      };
      put(next, "PATCH", `/api/reminders/${r.id}`, { ...patch, version: r.version }, "Recordatorio");
      return next;
    },

    snooze(r: Reminder, opts: { minutes: number } | { until: string }) {
      const until = "until" in opts ? opts.until : isoInZone(Temporal.Now.instant().add({ minutes: opts.minutes }));
      const next: Reminder = { ...r, fireAt: until, snoozedFrom: r.snoozedFrom ?? r.fireAt, status: "scheduled", version: r.version + 1 };
      put(next, "POST", `/api/reminders/${r.id}/snooze`, "until" in opts ? { until } : { minutes: opts.minutes }, "Pospuesto");
      return next;
    },

    done(r: Reminder) {
      const next: Reminder = r.rrule ? r : { ...r, status: "done", version: r.version + 1 };
      put(next, "POST", `/api/reminders/${r.id}/done`, {}, "Listo");
      return next;
    },

    cancel(r: Reminder) {
      void enqueue(qc, {
        method: "DELETE",
        path: `/api/reminders/${r.id}`,
        body: undefined,
        invalidate: REFRESH,
        optimistic: { kind: "reminder-remove", id: r.id },
        label: "Recordatorio cancelado",
      });
    },
  };
}

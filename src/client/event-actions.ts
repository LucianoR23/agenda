"use client";

import { useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { enqueue } from "./sync";
import type { AgendaEvent } from "./types";

const REFRESH = [JSON.stringify(["events"]), JSON.stringify(["reminders"])];

/** What the editor produces: timed (startsAt/endsAt) or all-day (startDate/endDate, exclusive end). */
export interface EventInput {
  title: string;
  notes?: string | null;
  location?: string | null;
  allDay: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  rrule?: string | null;
  reminderOffsets?: number[];
}

/** The occurrence the screens show until the server answers (recurring events: the first one). */
function asOccurrence(id: string, e: EventInput): AgendaEvent {
  return {
    id,
    eventId: id,
    externalEventId: null,
    source: "local",
    readOnly: false,
    title: e.title,
    notes: e.notes ?? null,
    location: e.location ?? null,
    allDay: e.allDay,
    startsAt: e.allDay ? null : (e.startsAt ?? null),
    endsAt: e.allDay ? null : (e.endsAt ?? null),
    startDate: e.allDay ? (e.startDate ?? null) : null,
    endDate: e.allDay ? (e.endDate ?? (e.startDate ? Temporal.PlainDate.from(e.startDate).add({ days: 1 }).toString() : null)) : null,
    recurring: Boolean(e.rrule),
    rrule: e.rrule ?? null,
    reminderOffsets: e.reminderOffsets ?? [],
    tentative: false,
    htmlLink: null,
    calendar: null,
  };
}

/** Body for create/update: only the fields of its kind (the API rejects mixing timed and all-day fields). */
function body(e: EventInput) {
  const common = {
    title: e.title,
    ...(e.notes ? { notes: e.notes } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.rrule ? { rrule: e.rrule } : {}),
    reminderOffsets: e.reminderOffsets ?? [],
  };
  return e.allDay
    ? { ...common, allDay: true, startDate: e.startDate, ...(e.endDate ? { endDate: e.endDate } : {}) }
    : { ...common, allDay: false, startsAt: e.startsAt, ...(e.endsAt ? { endsAt: e.endsAt } : {}) };
}

/** Local event writes: optimistic, through the outbox (offline-safe), like tasks and reminders. */
export function useEventActions() {
  const qc = useQueryClient();
  return {
    create(input: EventInput) {
      const id = uuidv7();
      const occurrence = asOccurrence(id, input);
      void enqueue(qc, {
        method: "POST",
        path: "/api/events",
        body: { id, ...body(input) },
        invalidate: REFRESH,
        optimistic: { kind: "event-put", event: occurrence },
        label: "Evento nuevo",
      });
      return occurrence;
    },

    /** Edits the whole series; every field is sent (the editor always has the full picture). */
    update(eventId: string, input: EventInput) {
      const b = body(input);
      const patch = {
        ...b,
        notes: input.notes || null,
        location: input.location || null,
        rrule: input.rrule ?? null,
        ...(input.allDay ? { endDate: input.endDate ?? null } : { endsAt: input.endsAt ?? null }),
      };
      void enqueue(qc, {
        method: "PATCH",
        path: `/api/events/${eventId}`,
        body: patch,
        invalidate: REFRESH,
        optimistic: { kind: "event-put", event: asOccurrence(eventId, input) },
        label: "Evento",
      });
    },

    remove(eventId: string) {
      void enqueue(qc, {
        method: "DELETE",
        path: `/api/events/${eventId}`,
        body: undefined,
        invalidate: REFRESH,
        optimistic: { kind: "event-remove", eventId },
        label: "Evento borrado",
      });
    },
  };
}

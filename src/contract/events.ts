import { ItemSource, LocalDate, Mutable, orNull, Timestamp, Uuid } from "./common";
import { z } from "./zod";

const Rrule = z.string().max(300).openapi({
  description: "RFC 5545 RRULE body without DTSTART (the event's start is), daily or longer. Edits apply to the whole series.",
  example: "FREQ=WEEKLY;BYDAY=TU,TH",
});

const Offsets = z
  .array(z.int().min(0).max(40_320))
  .max(5)
  .openapi({
    description: "Minutes before each occurrence to push a reminder (0 = at the start). Up to 5, max 4 weeks.",
    example: [30, 10],
  });

/** A local (editable) event. */
export const Event = z
  .strictObject({
    id: Uuid,
    title: z.string(),
    notes: z.string().nullable(),
    location: z.string().nullable(),
    allDay: z.boolean(),
    startsAt: orNull(Timestamp).openapi({ description: "Timed events." }),
    endsAt: orNull(Timestamp),
    startDate: orNull(LocalDate).openapi({ description: "All-day events." }),
    endDate: orNull(LocalDate).openapi({ description: "All-day events: exclusive (a one-day event ends the next day)." }),
    timezone: z.string().openapi({ description: "IANA zone the event lives in (recurrence expansion)." }),
    rrule: Rrule.nullable(),
    reminderOffsets: Offsets,
    source: ItemSource,
    ...Mutable,
  })
  .openapi("Event");

const Title = z.string().trim().min(1).max(500);

export const EventCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated id (offline creates)." }),
    title: Title,
    notes: z.string().max(10_000).optional(),
    location: z.string().max(500).optional(),
    allDay: z.boolean().optional().openapi({ description: "true → `startDate` (+ `endDate`); otherwise `startsAt` (+ `endsAt`)." }),
    startsAt: Timestamp.optional(),
    endsAt: Timestamp.optional(),
    startDate: LocalDate.optional(),
    endDate: LocalDate.optional().openapi({ description: "Exclusive; default the day after `startDate`." }),
    rrule: Rrule.optional(),
    reminderOffsets: Offsets.optional(),
  })
  .openapi("EventCreate");

export const EventPatch = z
  .strictObject({
    title: Title.optional(),
    notes: z.string().max(10_000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    allDay: z.boolean().optional(),
    startsAt: orNull(Timestamp).optional(),
    endsAt: orNull(Timestamp).optional(),
    startDate: orNull(LocalDate).optional(),
    endDate: orNull(LocalDate).optional(),
    rrule: Rrule.nullable().optional(),
    reminderOffsets: Offsets.optional(),
    version: z.int().min(1).optional(),
  })
  .openapi("EventPatch");

export const EventKind = z.enum(["local", "google", "ical"]).openapi("EventKind");

export const CalendarRef = z
  .strictObject({ id: Uuid, name: z.string(), color: z.string().nullable() })
  .openapi("CalendarRef", { description: "The Google/iCal calendar an external event comes from." });

/** One occurrence in a range: a local event (recurring ones expanded) or a synced Google/iCal event. */
export const AgendaEvent = z
  .strictObject({
    id: z.string().openapi({ description: "Unique per occurrence (a recurring local event repeats its eventId)." }),
    eventId: orNull(Uuid).openapi({ description: "Local event: use it with updateEvent/deleteEvent." }),
    externalEventId: orNull(Uuid).openapi({ description: "Google/iCal event: use it with remindExternalEvent." }),
    source: EventKind,
    readOnly: z.boolean().openapi({ description: "Google/iCal events can't be changed here." }),
    title: z.string(),
    notes: z.string().nullable(),
    location: z.string().nullable(),
    allDay: z.boolean(),
    startsAt: orNull(Timestamp),
    endsAt: orNull(Timestamp),
    startDate: orNull(LocalDate),
    endDate: orNull(LocalDate),
    recurring: z.boolean(),
    rrule: z.string().nullable(),
    reminderOffsets: z.array(z.int()),
    tentative: z.boolean(),
    htmlLink: z.string().nullable().openapi({ description: "Open in Google Calendar." }),
    calendar: orNull(CalendarRef),
  })
  .openapi("AgendaEvent");

export const EventQuery = z
  .strictObject({
    from: LocalDate.openapi({ description: "First day (user's timezone)." }),
    to: LocalDate.openapi({ description: "Last day, inclusive. At most 92 days after `from`." }),
    includeExternal: z.enum(["true", "false"]).optional().openapi({ description: "Google/iCal events too (default true)." }),
  })
  .openapi("EventQuery");

// ---------- calendars ----------

export const CalendarSource = z
  .strictObject({
    id: Uuid,
    kind: z.enum(["google", "ical"]),
    name: z.string(),
    color: z.string().nullable(),
    enabled: z.boolean(),
    reminderMinutes: z.int().nullable().openapi({ description: "Automatic push N minutes before each timed event; null = off." }),
    lastSyncedAt: orNull(Timestamp),
    lastError: z.string().nullable(),
  })
  .openapi("CalendarSource");

export const CalendarStatus = z
  .strictObject({
    google: z.strictObject({
      configured: z.boolean().openapi({ description: "The server has Google OAuth credentials." }),
      connected: z.boolean(),
      needsReconnect: z.boolean().openapi({ description: "Google rejected the stored grant: connect again." }),
      accountHint: z.string().nullable(),
    }),
    canAddIcal: z.boolean().openapi({ description: "ENCRYPTION_KEY is set (iCal URLs are stored encrypted)." }),
    sources: z.array(CalendarSource),
  })
  .openapi("CalendarStatus");

export const CalendarPatch = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    reminderMinutes: z.int().min(0).max(1440).nullable().optional(),
  })
  .openapi("CalendarPatch");

export const IcalCreate = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    url: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .openapi({ description: "The calendar's secret iCal address (https:// or webcal://). Stored encrypted, never shown again." }),
  })
  .openapi("IcalCreate");

export const SyncInput = z
  .strictObject({
    ifOlderThanSeconds: z
      .int()
      .min(0)
      .max(86_400)
      .optional()
      .openapi({ description: "Only sync when the last sync is older than this (the app sends 120 on open). Omit to force." }),
  })
  .openapi("SyncInput");

export const ExternalRemind = z
  .strictObject({
    minutesBefore: z.int().min(0).max(10_080).optional().openapi({ description: "Timed events: N minutes before the start." }),
    at: Timestamp.optional().openapi({ description: "Any moment (all-day events: e.g. that day 09:00)." }),
  })
  .refine((b) => (b.minutesBefore === undefined) !== (b.at === undefined), { message: "Use minutesBefore or at (one of them)" })
  .openapi("ExternalRemind");

import { ItemSource, Mutable, orNull, Timestamp, Uuid } from "./common";
import { z } from "./zod";

export const ReminderStatus = z.enum(["scheduled", "sent", "done", "cancelled", "missed"]).openapi("ReminderStatus", {
  description:
    "`scheduled`: waiting. `sent`: pushed (one-off). `done`: confirmed with Listo. `cancelled`: deleted. `missed`: the server was down longer than the user's `missedAfterHours` (no push).",
});

const Rrule = z
  .string()
  .max(300)
  .openapi({ description: "RFC 5545 RRULE body without DTSTART (the fire time is the start).", example: "FREQ=DAILY" });

export const Reminder = z
  .strictObject({
    id: Uuid,
    title: z.string(),
    body: z.string().nullable(),
    fireAt: Timestamp.openapi({ description: "Next (or last) moment it fires, in the user's timezone." }),
    rrule: Rrule.nullable(),
    status: ReminderStatus,
    urgent: z.boolean().openapi({ description: "Ignores quiet hours and goes out with high urgency." }),
    taskId: orNull(Uuid),
    eventId: orNull(Uuid).openapi({ description: 'Local event this reminder belongs to ("30 min antes").' }),
    externalEventId: orNull(Uuid).openapi({ description: "Google/iCal event this reminder belongs to." }),
    snoozedFrom: orNull(Timestamp).openapi({ description: "Original time of a postponed occurrence." }),
    lastFiredAt: orNull(Timestamp),
    source: ItemSource,
    ...Mutable,
  })
  .openapi("Reminder");

const Title = z.string().trim().min(1).max(500);

export const ReminderCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated id (offline creates)." }),
    title: Title,
    body: z.string().max(2000).optional(),
    fireAt: Timestamp,
    rrule: Rrule.optional(),
    urgent: z.boolean().optional(),
    taskId: Uuid.optional(),
  })
  .openapi("ReminderCreate");

export const ReminderPatch = z
  .strictObject({
    title: Title.optional(),
    body: z.string().max(2000).nullable().optional(),
    fireAt: Timestamp.optional().openapi({ description: "A new time re-arms a reminder that already fired." }),
    rrule: Rrule.nullable().optional(),
    urgent: z.boolean().optional(),
    taskId: orNull(Uuid).optional(),
    version: z.int().min(1).optional(),
  })
  .openapi("ReminderPatch");

export const SnoozeInput = z
  .strictObject({
    minutes: z.int().min(1).max(10_080).optional().openapi({ description: "Default: the user's snooze setting." }),
    until: Timestamp.optional(),
  })
  .refine((b) => !(b.minutes && b.until), { message: "Use minutes or until, not both" })
  .openapi("SnoozeInput");

export const ReminderQuery = z
  .strictObject({
    view: z.enum(["upcoming", "recent", "all"]).optional(),
    status: ReminderStatus.optional(),
    from: Timestamp.optional(),
    to: Timestamp.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .openapi("ReminderQuery");

export const PushAction = z
  .strictObject({
    token: z.string().min(10).max(500).openapi({ description: "`actionToken` from the push payload." }),
    action: z.enum(["done", "snooze"]),
  })
  .openapi("PushAction");

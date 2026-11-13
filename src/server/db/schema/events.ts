import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, bytea, createdAt, id, itemSourceEnum, syncable, updatedAt } from "./common";

export const eventSourceEnum = pgEnum("event_source", ["local", "google", "ical"]);
export const externalEventStatusEnum = pgEnum("external_event_status", ["confirmed", "tentative", "cancelled"]);

/**
 * A local event (editable). Timed events use instants; all-day events use dates with an exclusive end
 * (`2026-11-13` → `2026-11-14` is one day). Never both.
 */
export const event = pgTable(
  "event",
  {
    id: id(),
    clientId: text(),
    title: text().notNull(),
    notes: text(),
    location: text(),
    allDay: boolean().notNull().default(false),
    startsAt: at(),
    endsAt: at(),
    startDate: date({ mode: "string" }),
    endDate: date({ mode: "string" }),
    /** Zone the event was created in (RRULE expansion, display); defaults to the user's. */
    timezone: text().notNull(),
    rrule: text(),
    /** Minutes before each occurrence to remind, e.g. {30,10}. */
    reminderOffsets: integer().array().notNull().default(sql`'{}'::integer[]`),
    source: itemSourceEnum().notNull(),
    ...syncable(),
  },
  (t) => [
    uniqueIndex("event_client_id_uq").on(t.clientId),
    index("event_starts_idx").on(t.startsAt).where(sql`${t.deletedAt} IS NULL`),
    index("event_start_date_idx").on(t.startDate).where(sql`${t.deletedAt} IS NULL`),
    index("event_updated_idx").on(t.updatedAt),
    check(
      "event_timed_xor_all_day",
      sql`(${t.allDay} AND ${t.startDate} IS NOT NULL AND ${t.endDate} IS NOT NULL AND ${t.endDate} > ${t.startDate}
           AND ${t.startsAt} IS NULL AND ${t.endsAt} IS NULL)
       OR (NOT ${t.allDay} AND ${t.startsAt} IS NOT NULL AND ${t.startDate} IS NULL AND ${t.endDate} IS NULL
           AND (${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}))`,
    ),
    check("event_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 500`),
    check("event_client_id_length", sql`${t.clientId} IS NULL OR char_length(${t.clientId}) BETWEEN 1 AND 100`),
  ],
);

/** A read-only calendar: one Google calendar or one iCal URL (stored encrypted, AES-256-GCM). */
export const calendarSource = pgTable(
  "calendar_source",
  {
    id: id(),
    kind: eventSourceEnum().notNull(),
    externalCalendarId: text().notNull(),
    name: text().notNull(),
    color: text(),
    enabled: boolean().notNull().default(true),
    icalUrlEnc: bytea(),
    syncToken: text(),
    lastSyncedAt: at(),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("calendar_source_external_uq").on(t.kind, t.externalCalendarId),
    check("calendar_source_kind", sql`${t.kind} <> 'local'`),
    check("calendar_source_ical_url", sql`(${t.kind} = 'ical') = (${t.icalUrlEnc} IS NOT NULL)`),
  ],
);

/** The Google account connection (singleton). The refresh token is encrypted with ENCRYPTION_KEY. */
export const googleCredential = pgTable(
  "google_credential",
  {
    id: id(),
    singleton: boolean().notNull().default(true).unique("google_credential_singleton_uq"),
    refreshTokenEnc: bytea().notNull(),
    scopes: text().array().notNull(),
    /** Display only ("l…@gmail.com"). */
    accountHint: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("google_credential_singleton", sql`${t.singleton}`)],
);

/** A synced Google/iCal event instance (recurring events are expanded). Read-only through the API. */
export const externalEvent = pgTable(
  "external_event",
  {
    id: id(),
    sourceId: uuid()
      .notNull()
      .references(() => calendarSource.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    etag: text(),
    title: text().notNull(),
    location: text(),
    allDay: boolean().notNull().default(false),
    startsAt: at(),
    endsAt: at(),
    startDate: date({ mode: "string" }),
    endDate: date({ mode: "string" }),
    status: externalEventStatusEnum().notNull().default("confirmed"),
    htmlLink: text(),
    updatedRemoteAt: at(),
    syncedAt: at().notNull().defaultNow(),
  },
  (t) => [
    unique("external_event_source_external_uq").on(t.sourceId, t.externalId),
    index("external_event_starts_idx").on(t.startsAt),
    index("external_event_start_date_idx").on(t.startDate),
    check(
      "external_event_timed_xor_all_day",
      sql`(${t.allDay} AND ${t.startDate} IS NOT NULL AND ${t.startsAt} IS NULL)
       OR (NOT ${t.allDay} AND ${t.startsAt} IS NOT NULL AND ${t.startDate} IS NULL)`,
    ),
  ],
);

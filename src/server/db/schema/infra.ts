import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, uuid } from "drizzle-orm/pg-core";
import { apiToken } from "./auth";
import { at, createdAt, id, itemSourceEnum } from "./common";
import { reminder } from "./reminders";

export const changeActionEnum = pgEnum("change_action", ["create", "update", "delete"]);
export const notificationKindEnum = pgEnum("notification_kind", ["reminder", "notice", "test"]);

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/**
 * Append-only log, one row per write. The UUIDv7 id is time-ordered, so it doubles as the cursor for offline
 * delta sync ("what changed since <id>"). `token_id` names the exact API token when `actor = 'sunday'`.
 */
export const changeLog = pgTable(
  "change_log",
  {
    id: id(),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: changeActionEnum().notNull(),
    actor: itemSourceEnum().notNull(),
    tokenId: uuid().references(() => apiToken.id, { onDelete: "set null" }),
    diff: jsonb().$type<{ before?: unknown; after?: unknown; fields?: FieldDiff }>(),
    requestId: text(),
    at: at().notNull().defaultNow(),
  },
  (t) => [index("change_log_at_idx").on(t.at), index("change_log_entity_idx").on(t.entity, t.entityId)],
);

/**
 * Idempotency-Key store (24 h). `scope` is who called: `session` for the app, `token:<id>` for an API token, so
 * two callers can never collide on the same key.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    scope: text().notNull(),
    key: text().notNull(),
    method: text().notNull(),
    path: text().notNull(),
    requestHash: text().notNull(),
    // null while the first request is still in flight
    responseStatus: integer(),
    // serialized JSON text, so a replay is byte-identical to the original response
    responseBody: text(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "idempotency_key_pk", columns: [t.scope, t.key] }),
    index("idempotency_key_created_idx").on(t.createdAt),
    check("idempotency_key_length", sql`char_length(${t.key}) BETWEEN 1 AND 200`),
  ],
);

/** Every push sent: reminders, notices (Sunday automations, "Google desconectado") and test pushes. Pruned at 180 days. */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: id(),
    kind: notificationKindEnum().notNull(),
    title: text().notNull(),
    body: text(),
    url: text(),
    reminderId: uuid().references(() => reminder.id, { onDelete: "set null" }),
    source: itemSourceEnum().notNull(),
    tokenId: uuid().references(() => apiToken.id, { onDelete: "set null" }),
    devicesOk: smallint().notNull().default(0),
    devicesFailed: smallint().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("notification_log_created_idx").on(t.createdAt)],
);

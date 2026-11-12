import { date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorEnum, createdAt, id } from "./common";

export const changeActionEnum = pgEnum("change_action", ["create", "update", "delete"]);

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/** Append-only audit log; one row per write. */
export const changeLog = pgTable(
  "change_log",
  {
    id: id(),
    actor: actorEnum().notNull(),
    entity: text().notNull(),
    entityId: uuid(),
    // local day the change belongs to (null for global entities)
    date: date({ mode: "string" }),
    action: changeActionEnum().notNull(),
    diff: jsonb().$type<{ before?: unknown; after?: unknown; fields?: FieldDiff }>(),
    requestId: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("change_log_at_idx").on(t.at),
    index("change_log_date_idx").on(t.date),
    index("change_log_entity_idx").on(t.entity, t.entityId),
  ],
);

/** Idempotency-Key store (TTL 48 h). */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    key: text().notNull(),
    actor: actorEnum().notNull(),
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
    primaryKey({ name: "idempotency_key_pk", columns: [t.actor, t.key] }),
    index("idempotency_key_created_idx").on(t.createdAt),
  ],
);


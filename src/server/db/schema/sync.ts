import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { actorEnum, createdAt, id, updatedAt } from "./common";

export const changeActionEnum = pgEnum("change_action", [
  "create",
  "update",
  "delete",
  "replace",
  "choose",
  "close",
  "propose",
  "accept",
  "reject",
]);

export const webhookStatusEnum = pgEnum("webhook_status", [
  "collecting", // debounce window open, still accepting changes
  "pending", // ready to deliver / waiting for retry
  "sent",
  "failed", // gave up after max attempts
]);

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/** Append-only audit log; one row per write. */
export const changeLog = pgTable(
  "change_log",
  {
    id: id(),
    actor: actorEnum().notNull(),
    entity: text().notNull(),
    entityId: uuid(),
    // local day the change belongs to (null for global entities like habits/devices)
    date: date({ mode: "string" }),
    action: changeActionEnum().notNull(),
    diff: jsonb().$type<{ before?: unknown; after?: unknown; fields?: FieldDiff }>(),
    // true when the agent used `force` / `?mode=force`
    forced: boolean().notNull().default(false),
    requestId: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("change_log_at_idx").on(t.at),
    index("change_log_date_idx").on(t.date),
    index("change_log_entity_idx").on(t.entity, t.entityId),
  ],
);

/** Outbound webhook batches to Agenbot (user changes only, debounced per day). */
export const webhookOutbox = pgTable(
  "webhook_outbox",
  {
    id: id(), // doubles as batchId and Idempotency-Key
    date: date({ mode: "string" }).notNull(),
    payload: jsonb().notNull(),
    status: webhookStatusEnum().notNull().default("collecting"),
    attempts: smallint().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull(),
    lastAttemptAt: timestamp({ withTimezone: true }),
    lastResponseStatus: smallint(),
    lastError: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("webhook_outbox_one_collecting_per_day_uq")
      .on(t.date)
      .where(sql`${t.status} = 'collecting'`),
    index("webhook_outbox_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN ('collecting', 'pending')`),
  ],
);

/** Idempotency-Key store (TTL 48 h, purged by the close-day job). */
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
    responseBody: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "idempotency_key_pk", columns: [t.actor, t.key] }),
    index("idempotency_key_created_idx").on(t.createdAt),
  ],
);

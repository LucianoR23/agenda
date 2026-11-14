import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { at, bytea, createdAt, id, updatedAt } from "./common";

export const lockoutScopeEnum = pgEnum("lockout_scope", ["device", "ip", "global"]);
export const authMethodEnum = pgEnum("auth_method", ["setup", "pin", "passkey", "recovery_code", "reset_code", "token"]);
export const tokenScopeEnum = pgEnum("token_scope", ["read", "write", "notify"]);
export type TokenScope = (typeof tokenScopeEnum.enumValues)[number];

/** The single human user and their settings. The unique `singleton` column makes a second row impossible. */
export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    singleton: boolean().notNull().default(true).unique("app_user_singleton_uq"),
    pinHash: text().notNull(),
    pinUpdatedAt: at().notNull().defaultNow(),
    // WebAuthn user handle (random bytes, not personally identifying)
    webauthnUserId: bytea().notNull(),
    /** IANA zone for every local date/time (validated by the app). */
    timezone: text().notNull().default("America/Buenos_Aires"),
    locale: text().notNull().default("es-AR"),
    /** Non-urgent reminders inside quiet hours are delivered when they end. */
    quietStart: time().default("23:30"),
    quietEnd: time().default("07:00"),
    defaultSnoozeMinutes: smallint().notNull().default(10),
    /** A reminder more than this late (e.g. the server was down) is marked missed instead of pushed. */
    missedAfterHours: smallint().notNull().default(12),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("app_user_singleton", sql`${t.singleton}`),
    check("app_user_snooze_range", sql`${t.defaultSnoozeMinutes} BETWEEN 1 AND 1440`),
    check("app_user_missed_range", sql`${t.missedAfterHours} BETWEEN 1 AND 168`),
    check("app_user_quiet_both", sql`(${t.quietStart} IS NULL) = (${t.quietEnd} IS NULL)`),
  ],
);

export const recoveryCode = pgTable("recovery_code", {
  id: id(),
  hash: text().notNull(),
  usedAt: at(),
  createdAt: createdAt(),
});

/** One-time codes printed by `pnpm auth:reset-pin` (valid 15 min). */
export const pinResetCode = pgTable("pin_reset_code", {
  id: id(),
  hash: text().notNull(),
  expiresAt: at().notNull(),
  usedAt: at(),
  createdAt: createdAt(),
});

/** A trusted browser. The session cookie holds a random token; only its SHA-256 is stored. */
export const device = pgTable(
  "device",
  {
    id: id(),
    name: text().notNull(),
    userAgent: text(),
    sessionHash: text().notNull().unique("device_session_hash_uq"),
    lastSeenAt: at().notNull().defaultNow(),
    lastUnlockAt: at().notNull().defaultNow(),
    revokedAt: at(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("device_active_idx").on(t.lastSeenAt).where(sql`${t.revokedAt} IS NULL`)],
);

/** Fingerprint passkey, at most one per device. */
export const passkey = pgTable("passkey", {
  id: id(),
  deviceId: uuid()
    .notNull()
    .unique("passkey_device_uq")
    .references(() => device.id, { onDelete: "cascade" }),
  credentialId: text().notNull().unique("passkey_credential_id_uq"), // base64url
  publicKey: bytea().notNull(),
  counter: bigint({ mode: "number" }).notNull().default(0),
  transports: text().array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  lastUsedAt: at(),
});

/**
 * Brute-force counters with exponential backoff. `key`: device id or pre-auth device-key cookie (scope=device),
 * client IP (scope=ip), or the literal "global" (scope=global: alerts/delay only, never a lock; see docs/v2/07).
 */
export const authLockout = pgTable(
  "auth_lockout",
  {
    scope: lockoutScopeEnum().notNull(),
    key: text().notNull(),
    failedCount: integer().notNull().default(0),
    lockoutCount: integer().notNull().default(0),
    lockedUntil: at(),
    lastFailedAt: at(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: "auth_lockout_pk", columns: [t.scope, t.key] })],
);

/** Every credential check (pruned after 90 days). */
export const authAttempt = pgTable(
  "auth_attempt",
  {
    id: id(),
    method: authMethodEnum().notNull(),
    success: boolean().notNull(),
    deviceKey: text(),
    deviceId: uuid().references(() => device.id, { onDelete: "set null" }),
    ip: text(),
    userAgent: text(),
    at: at().notNull().defaultNow(),
  },
  (t) => [index("auth_attempt_at_idx").on(t.at)],
);

/** Web Push endpoint of one device. Disabled after repeated failures; deleted on 404/410. */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: id(),
    deviceId: uuid()
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    endpoint: text().notNull().unique("push_subscription_endpoint_uq"),
    p256dh: text().notNull(),
    auth: text().notNull(),
    failureCount: integer().notNull().default(0),
    lastSuccessAt: at(),
    lastError: text(),
    disabledAt: at(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("push_subscription_device_idx").on(t.deviceId)],
);

/**
 * Named API token (Sunday). The secret is `agd_<32 random bytes base64url>`, shown once; only its SHA-256 is
 * stored. `token_prefix` (first 8 chars) is for display.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: id(),
    name: text().notNull(),
    tokenPrefix: text().notNull(),
    tokenHash: text().notNull().unique("api_token_hash_uq"),
    scopes: tokenScopeEnum().array().notNull(),
    lastUsedAt: at(),
    lastUsedIp: text(),
    expiresAt: at(),
    revokedAt: at(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_token_active_name_uq").on(t.name).where(sql`${t.revokedAt} IS NULL`),
    check("api_token_has_scopes", sql`cardinality(${t.scopes}) > 0`),
    check("api_token_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
  ],
);

/** Security-relevant events (logins, token create/revoke, device revoke…). Pruned after 90 days. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    kind: text().notNull(),
    deviceId: uuid().references(() => device.id, { onDelete: "set null" }),
    tokenId: uuid().references(() => apiToken.id, { onDelete: "set null" }),
    ip: text(),
    userAgent: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    at: at().notNull().defaultNow(),
  },
  (t) => [index("audit_event_at_idx").on(t.at), index("audit_event_kind_idx").on(t.kind, t.at)],
);

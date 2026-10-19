import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./common";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

export const lockoutScopeEnum = pgEnum("lockout_scope", ["device", "global"]);
export const authMethodEnum = pgEnum("auth_method", [
  "setup",
  "pin",
  "passkey",
  "recovery_code",
  "reset_code",
]);

/** The single human user. The unique `singleton` column makes a second row impossible. */
export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    singleton: boolean().notNull().default(true).unique("app_user_singleton_uq"),
    pinHash: text().notNull(),
    pinUpdatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // WebAuthn user handle (random bytes, not personally identifying)
    webauthnUserId: bytea().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_user_singleton", sql`${t.singleton}`)],
);

export const recoveryCode = pgTable("recovery_code", {
  id: id(),
  hash: text().notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

/** One-time codes printed by `pnpm auth:reset-pin` (valid 15 min). */
export const pinResetCode = pgTable("pin_reset_code", {
  id: id(),
  hash: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
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
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUnlockAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
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
  transports: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  lastUsedAt: timestamp({ withTimezone: true }),
});

/**
 * Brute-force counters. For scope=device, `key` is the pre-auth device-key cookie (a browser
 * that never logged in has no `device` row yet); for scope=global it is the literal "global".
 */
export const authLockout = pgTable(
  "auth_lockout",
  {
    scope: lockoutScopeEnum().notNull(),
    key: text().notNull(),
    failedCount: integer().notNull().default(0),
    // lock duration = 15 min * 2^(lockoutCount - 1), capped at 24 h
    lockoutCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastFailedAt: timestamp({ withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: "auth_lockout_pk", columns: [t.scope, t.key] })],
);

/** Audit trail of every credential check. */
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
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_attempt_at_idx").on(t.at)],
);

export const pushSubscription = pgTable("push_subscription", {
  id: id(),
  deviceId: uuid()
    .notNull()
    .references(() => device.id, { onDelete: "cascade" }),
  endpoint: text().notNull().unique("push_subscription_endpoint_uq"),
  p256dh: text().notNull(),
  auth: text().notNull(),
  // per-device toggle for the 10-min reminder before call blocks
  callReminders: boolean().notNull().default(true),
  // per-device toggle for the morning reminder when last night's sleep is incomplete
  sleepReminders: boolean().notNull().default(true),
  failureCount: integer().notNull().default(0),
  lastSuccessAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

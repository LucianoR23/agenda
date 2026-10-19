import { LocalDate, orNull, Timestamp, Uuid } from "./common";
import { z } from "./zod";

// ---------- auth ----------

const Pin = z
  .string()
  .regex(/^\d{6}$/, "PIN must be exactly 6 digits")
  .openapi("Pin", { example: "482913" });

export const SessionState = z
  .strictObject({
    state: z.enum(["setup_required", "unauthenticated", "locked", "unlocked"]).openapi({
      description:
        "`setup_required`: no user yet. `unauthenticated`: unknown/revoked device. `locked`: known device unused for more than PIN_REAUTH_DAYS. `unlocked`: session valid.",
    }),
    passkeyEnabled: z.boolean().openapi({ description: "This device has a fingerprint passkey." }),
    lockedUntil: orNull(Timestamp).openapi({ description: "Set while PIN entry is locked out." }),
    device: z.strictObject({ id: Uuid, name: z.string() }).nullable(),
  })
  .openapi("SessionState");

export const Device = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    userAgent: z.string().nullable(),
    current: z.boolean(),
    passkeyEnabled: z.boolean(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp,
    lastUnlockAt: Timestamp,
  })
  .openapi("Device");

export const SetupInput = z
  .strictObject({ setupCode: z.string().min(1).max(200), pin: Pin, deviceName: z.string().max(80).optional() })
  .openapi("SetupInput");

export const RecoveryCodes = z
  .strictObject({
    recoveryCodes: z
      .array(z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/))
      .length(10)
      .openapi({ description: "Shown once. Single use each." }),
  })
  .openapi("RecoveryCodes");

export const SetupResult = z
  .strictObject({ device: Device, ...RecoveryCodes.shape })
  .openapi("SetupResult");

export const UnlockInput = z
  .strictObject({ pin: Pin, deviceName: z.string().max(80).optional() })
  .openapi("UnlockInput");

export const UnlockResult = z.strictObject({ device: Device }).openapi("UnlockResult");

export const RecoverInput = z
  .strictObject({
    method: z.enum(["recovery_code", "reset_code"]).openapi({
      description: "`recovery_code`: one of the 10 codes. `reset_code`: printed by `pnpm auth:reset-pin` (15 min).",
    }),
    code: z.string().min(4).max(64),
    newPin: Pin,
    deviceName: z.string().max(80).optional(),
  })
  .openapi("RecoverInput");

export const RecoverResult = z
  .strictObject({ device: Device, remainingRecoveryCodes: z.int() })
  .openapi("RecoverResult");

export const ChangePinInput = z.strictObject({ currentPin: Pin, newPin: Pin }).openapi("ChangePinInput");

export const PinConfirmInput = z.strictObject({ pin: Pin }).openapi("PinConfirmInput");

export const DeviceRename = z.strictObject({ name: z.string().min(1).max(80) }).openapi("DeviceRename");

/** WebAuthn JSON payloads are produced/consumed by @simplewebauthn; documented as opaque objects. */
export const WebAuthnJson = z
  .record(z.string(), z.unknown())
  .openapi("WebAuthnJson", {
    description: "`PublicKeyCredential*OptionsJSON` or `*ResponseJSON` from @simplewebauthn (opaque here).",
  });

export const PasskeyVerifyInput = z.strictObject({ response: WebAuthnJson }).openapi("PasskeyVerifyInput");

export const PasskeyInfo = z
  .strictObject({ id: Uuid, deviceId: Uuid, createdAt: Timestamp, lastUsedAt: orNull(Timestamp) })
  .openapi("PasskeyInfo");

// ---------- push ----------

export const PushSubscribeInput = z
  .strictObject({
    endpoint: z.url(),
    keys: z.strictObject({ p256dh: z.string().min(1), auth: z.string().min(1) }),
    callReminders: z.boolean().optional().openapi({ description: "10-minute reminder before each call block." }),
  })
  .openapi("PushSubscribeInput");

export const PushUnsubscribeInput = z.strictObject({ endpoint: z.url() }).openapi("PushUnsubscribeInput");

export const PushSubscription = z
  .strictObject({ id: Uuid, deviceId: Uuid, endpoint: z.string(), callReminders: z.boolean(), createdAt: Timestamp })
  .openapi("PushSubscription");

// ---------- ops ----------

export const Health = z
  .strictObject({
    status: z.enum(["ok", "degraded"]),
    db: z.enum(["ok", "down"]),
    version: z.string(),
    time: Timestamp,
  })
  .openapi("Health");

export const CloseDayInput = z
  .strictObject({
    date: LocalDate.optional().openapi({ description: "Close only this date. Default: every unclosed day before today (ART)." }),
  })
  .openapi("CloseDayInput");

export const CloseDayResult = z
  .strictObject({
    closed: z.array(LocalDate),
    purgedIdempotencyKeys: z.int(),
  })
  .openapi("CloseDayResult");

export const WebhookStatus = z
  .strictObject({
    configured: z.boolean(),
    lastDelivery: z
      .strictObject({
        batchId: Uuid,
        date: LocalDate,
        status: z.enum(["collecting", "pending", "sent", "failed"]),
        attempts: z.int(),
        lastAttemptAt: orNull(Timestamp),
        lastResponseStatus: z.int().nullable(),
        lastError: z.string().nullable(),
        sentAt: orNull(Timestamp),
      })
      .nullable(),
    queued: z.int().openapi({ description: "Batches collecting or waiting for (re)delivery." }),
    failedLast7Days: z.int(),
  })
  .openapi("WebhookStatus");

export const ExportBundle = z
  .strictObject({
    exportedAt: Timestamp,
    schemaVersion: z.literal(1),
    days: z.array(z.unknown()),
    habits: z.array(z.unknown()),
    habitLogs: z.array(z.unknown()),
    tasks: z.array(z.unknown()),
    proposals: z.array(z.unknown()),
    changeLog: z.array(z.unknown()),
  })
  .openapi("ExportBundle", {
    description: "All personal data as JSON (no auth secrets: no PIN/recovery hashes, sessions or passkeys).",
  });

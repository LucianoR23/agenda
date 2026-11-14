import { orNull, Timestamp, Uuid } from "./common";
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
    vapidPublicKey: z.string().nullable().openapi({ description: "Web Push application server key; null when push is not configured." }),
    timezone: z
      .string()
      .openapi({ description: "The user's IANA timezone (every local date/time uses it).", example: "America/Buenos_Aires" }),
  })
  .openapi("SessionState");

export const ReauthResult = z
  .strictObject({ validUntil: Timestamp.openapi({ description: "Sensitive actions (API tokens) are allowed until then." }) })
  .openapi("ReauthResult");

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

export const SetupResult = z.strictObject({ device: Device, ...RecoveryCodes.shape }).openapi("SetupResult");

export const UnlockInput = z.strictObject({ pin: Pin, deviceName: z.string().max(80).optional() }).openapi("UnlockInput");

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

export const RecoverResult = z.strictObject({ device: Device, remainingRecoveryCodes: z.int() }).openapi("RecoverResult");

export const ChangePinInput = z.strictObject({ currentPin: Pin, newPin: Pin }).openapi("ChangePinInput");

export const PinConfirmInput = z.strictObject({ pin: Pin }).openapi("PinConfirmInput");

export const DeviceRename = z.strictObject({ name: z.string().min(1).max(80) }).openapi("DeviceRename");

/** WebAuthn JSON payloads are produced/consumed by @simplewebauthn; documented as opaque objects. */
export const WebAuthnJson = z.record(z.string(), z.unknown()).openapi("WebAuthnJson", {
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
  })
  .openapi("PushSubscribeInput");

export const PushUnsubscribeInput = z.strictObject({ endpoint: z.url() }).openapi("PushUnsubscribeInput");

export const PushSubscription = z
  .strictObject({
    id: Uuid,
    deviceId: Uuid,
    endpoint: z.string(),
    createdAt: Timestamp,
  })
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

// ---------- settings ----------

const HHmm = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Expected HH:mm")
  .openapi({ example: "23:30" });

export const Settings = z
  .strictObject({
    timezone: z.string().openapi({ description: "IANA timezone.", example: "America/Buenos_Aires" }),
    locale: z.string(),
    quietStart: HHmm.nullable().openapi({ description: "Quiet hours start (local). Non-urgent reminders wait until quietEnd." }),
    quietEnd: HHmm.nullable(),
    defaultSnoozeMinutes: z.int(),
    missedAfterHours: z.int().openapi({ description: "A reminder later than this (server down) is marked missed instead of pushed." }),
  })
  .openapi("Settings");

export const SettingsPatch = z
  .strictObject({
    timezone: z.string().min(1).max(64).optional(),
    locale: z.string().min(2).max(16).optional(),
    quietStart: HHmm.nullable().optional(),
    quietEnd: HHmm.nullable().optional(),
    defaultSnoozeMinutes: z.int().min(1).max(1440).optional(),
    missedAfterHours: z.int().min(1).max(168).optional(),
  })
  .openapi("SettingsPatch");

// ---------- API tokens ----------

export const TokenScope = z.enum(["read", "write", "notify"]).openapi("TokenScope", {
  description: "`read`: query the agenda. `write`: create/change items. `notify`: send pushes.",
});

export const ApiToken = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    prefix: z.string().openapi({ description: "First 8 characters, for recognising the token.", example: "agd_x7Kp" }),
    scopes: z.array(TokenScope),
    lastUsedAt: orNull(Timestamp),
    lastUsedIp: z.string().nullable(),
    expiresAt: orNull(Timestamp),
    createdAt: Timestamp,
  })
  .openapi("ApiToken");

export const TokenCreateInput = z
  .strictObject({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(TokenScope).min(1),
    expiresAt: Timestamp.optional(),
  })
  .openapi("TokenCreateInput");

export const TokenCreated = z
  .strictObject({
    ...ApiToken.shape,
    token: z.string().openapi({ description: "The secret (`agd_…`). Shown only in this response.", example: "agd_x7Kp…" }),
  })
  .openapi("TokenCreated");

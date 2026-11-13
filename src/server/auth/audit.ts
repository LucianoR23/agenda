import type { DbLike } from "../db/client";
import { auditEvent } from "../db/schema";
import { toDate } from "../domain/time";
import type { Ctx } from "../http/context";
import { tokenIdOf } from "../http/context";

/** Security-relevant event kinds (audit_event.kind). Pruned after 90 days. */
export type AuditKind =
  | "setup"
  | "unlock"
  | "reauth"
  | "recover"
  | "pin_changed"
  | "recovery_codes_regenerated"
  | "passkey_registered"
  | "passkey_removed"
  | "device_renamed"
  | "device_revoked"
  | "logout"
  | "token_created"
  | "token_revoked"
  | "lockout"
  | "failed_attempts_alert"
  | "settings_changed";

/** Records an audit event. Pass `db` to write outside the request transaction (e.g. next to a failure). */
export async function audit(ctx: Ctx, kind: AuditKind, details: Record<string, unknown> = {}, db: DbLike = ctx.db) {
  await db.insert(auditEvent).values({
    kind,
    deviceId: ctx.caller.kind === "user" ? ctx.caller.deviceId : (ctx.sessionDevice?.id ?? null),
    tokenId: tokenIdOf(ctx.caller),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    details,
    at: toDate(ctx.now),
  });
}

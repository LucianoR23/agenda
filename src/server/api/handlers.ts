import { eq, sql } from "drizzle-orm";
import { generateOpenApiDocument, withoutExamples } from "@/contract/openapi";
import { audit } from "../auth/audit";
import * as auth from "../auth/auth";
import * as tokens from "../auth/tokens";
import { getDb } from "../db/client";
import { one } from "../db/one";
import { pushSubscription } from "../db/schema";
import { getSettings, updateSettings } from "../domain/settings";
import { formatInstant } from "../domain/time";
import { env } from "../env";
import { type Handler, json, requireDevice } from "../http/context";

let openApiFull: unknown = null;
let openApiCompact: unknown = null;

export const handlers: Record<string, Handler> = {
  // ---------- ops ----------
  health: async (ctx) => {
    let db: "ok" | "down" = "ok";
    try {
      await getDb().execute(sql`select 1`);
    } catch {
      db = "down";
    }
    return json(db === "ok" ? 200 : 503, {
      status: db === "ok" ? "ok" : "degraded",
      db,
      version: env().APP_VERSION,
      time: formatInstant(ctx.now, ctx.tz),
    });
  },
  openapi: async (_ctx, { query }) => {
    openApiFull ??= generateOpenApiDocument();
    openApiCompact ??= withoutExamples(openApiFull);
    return json(200, query.examples === "true" ? openApiFull : openApiCompact, { "Cache-Control": "public, max-age=300" });
  },

  // ---------- push ----------
  pushSubscribe: async (ctx, { body }) => {
    const values = { deviceId: requireDevice(ctx).id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
    // subscribing again re-enables an endpoint that was disabled after failures
    const reset = { failureCount: 0, lastError: null, disabledAt: null };
    const row = one(
      await ctx.db
        .insert(pushSubscription)
        .values(values)
        .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { ...values, ...reset } })
        .returning(),
      "push subscription upsert",
    );
    return json(201, {
      id: row.id,
      deviceId: row.deviceId,
      endpoint: row.endpoint,
      createdAt: formatInstant(row.createdAt, ctx.tz),
    });
  },
  pushUnsubscribe: async (ctx, { body }) => {
    await ctx.db.delete(pushSubscription).where(eq(pushSubscription.endpoint, body.endpoint));
    return { status: 204 };
  },

  // ---------- auth ----------
  getSession: async (ctx) => json(200, await auth.sessionState(ctx)),
  setup: async (ctx, { body }) => json(201, await auth.setup(ctx, body)),
  unlock: async (ctx, { body }) => json(200, await auth.unlock(ctx, body)),
  recover: async (ctx, { body }) => json(200, await auth.recover(ctx, body)),
  changePin: async (ctx, { body }) => {
    await auth.changePin(ctx, body);
    return { status: 204 };
  },
  regenerateRecoveryCodes: async (ctx, { body }) => json(200, await auth.regenerateRecoveryCodes(ctx, body.pin)),
  passkeyRegisterOptions: async (ctx) => json(200, await auth.passkeyRegisterOptions(ctx)),
  passkeyRegisterVerify: async (ctx, { body }) => json(201, await auth.passkeyRegisterVerify(ctx, body.response)),
  passkeyAuthOptions: async (ctx) => json(200, await auth.passkeyAuthOptions(ctx)),
  passkeyAuthVerify: async (ctx, { body }) => json(200, await auth.passkeyAuthVerify(ctx, body.response)),
  deletePasskey: async (ctx) => {
    await auth.deletePasskey(ctx);
    return { status: 204 };
  },
  listDevices: async (ctx) => json(200, { devices: await auth.listDevices(ctx) }),
  renameDevice: async (ctx, { params, body }) => json(200, await auth.renameDevice(ctx, params.id, body.name)),
  revokeDevice: async (ctx, { params }) => {
    await auth.revokeDevice(ctx, params.id);
    return { status: 204 };
  },
  logout: async (ctx) => {
    await auth.revokeDevice(ctx, requireDevice(ctx).id, "logout");
    return { status: 204 };
  },
  reauth: async (ctx, { body }) => json(200, await auth.reauth(ctx, body.pin)),

  // ---------- settings ----------
  getSettings: async (ctx) => json(200, await getSettings(ctx.db)),
  updateSettings: async (ctx, { body }) => {
    const before = await getSettings(ctx.db);
    const next = await updateSettings(ctx.db, body);
    await audit(ctx, "settings_changed", { before, after: next });
    return json(200, next);
  },

  // ---------- API tokens ----------
  listTokens: async (ctx) => json(200, { tokens: await tokens.listTokens(ctx) }),
  createToken: async (ctx, { body }) => json(201, await tokens.createToken(ctx, body)),
  revokeToken: async (ctx, { params }) => {
    await tokens.revokeToken(ctx, params.id);
    return { status: 204 };
  },
};

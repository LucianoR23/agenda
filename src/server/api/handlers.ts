import { eq, sql } from "drizzle-orm";
import { generateOpenApiDocument, withoutExamples } from "@/contract/openapi";
import * as auth from "../auth/auth";
import { getDb } from "../db/client";
import { pushSubscription } from "../db/schema";
import { env } from "../env";
import { type Handler, json } from "../http/context";
import { isoLocal } from "../time";

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
    return json(db === "ok" ? 200 : 503, { status: db === "ok" ? "ok" : "degraded", db, version: env().APP_VERSION, time: isoLocal(ctx.now) });
  },
  openapi: async (_ctx, { query }) => {
    openApiFull ??= generateOpenApiDocument();
    openApiCompact ??= withoutExamples(openApiFull);
    return json(200, query.examples === "true" ? openApiFull : openApiCompact, { "Cache-Control": "public, max-age=300" });
  },

  // ---------- push ----------
  pushSubscribe: async (ctx, { body }) => {
    const values = {
      deviceId: ctx.sessionDevice!.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ...(body.callReminders !== undefined ? { callReminders: body.callReminders } : {}),
      ...(body.sleepReminders !== undefined ? { sleepReminders: body.sleepReminders } : {}),
    };
    const [row] = await ctx.db
      .insert(pushSubscription)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: values })
      .returning();
    return json(201, { id: row.id, deviceId: row.deviceId, endpoint: row.endpoint, callReminders: row.callReminders, sleepReminders: row.sleepReminders, createdAt: isoLocal(row.createdAt) });
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
    await auth.revokeDevice(ctx, ctx.sessionDevice!.id);
    return { status: 204 };
  },
};

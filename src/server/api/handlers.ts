import { eq, sql } from "drizzle-orm";
import { generateOpenApiDocument, withoutExamples } from "@/contract/openapi";
import { audit } from "../auth/audit";
import * as auth from "../auth/auth";
import * as tokens from "../auth/tokens";
import { getDb } from "../db/client";
import { one } from "../db/one";
import { pushSubscription } from "../db/schema";
import { applyPushAction } from "../domain/push-actions";
import * as reminders from "../domain/reminders";
import { getSettings, updateSettings } from "../domain/settings";
import * as tasks from "../domain/tasks";
import { formatInstant } from "../domain/time";
import { env } from "../env";
import { type Handler, json, requireDevice } from "../http/context";
import { sendNotice } from "../push";

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

  // ---------- tasks ----------
  listTaskLists: async (ctx) => json(200, { lists: await tasks.listLists(ctx) }),
  createTaskList: async (ctx, { body }) => json(201, await tasks.createList(ctx, body)),
  updateTaskList: async (ctx, { params, body }) => json(200, await tasks.updateList(ctx, params.id, body)),
  deleteTaskList: async (ctx, { params }) => json(200, await tasks.deleteList(ctx, params.id)),
  listTasks: async (ctx, { query }) => json(200, { tasks: await tasks.listTasks(ctx, query) }),
  getTask: async (ctx, { params }) => json(200, await tasks.getTask(ctx, params.id)),
  createTask: async (ctx, { body }) => json(201, await tasks.createTask(ctx, body)),
  updateTask: async (ctx, { params, body }) => json(200, await tasks.updateTask(ctx, params.id, body)),
  completeTask: async (ctx, { params, body }) => json(200, await tasks.completeTask(ctx, params.id, body.version)),
  reopenTask: async (ctx, { params, body }) => json(200, await tasks.reopenTask(ctx, params.id, body.nextId)),
  deleteTask: async (ctx, { params }) => {
    await tasks.deleteTask(ctx, params.id);
    return { status: 204 };
  },
  reorderTasks: async (ctx, { body }) => json(200, { tasks: await tasks.reorderTasks(ctx, body.ids) }),
  searchAgenda: async (ctx, { query }) => {
    const includeDone = query.includeDone === "true";
    const foundTasks = await tasks.searchTasks(ctx, query.q, includeDone, query.limit);
    const foundReminders = await reminders.searchReminders(ctx, query.q, includeDone, query.limit);
    return json(200, {
      results: [
        ...foundTasks.map((task) => ({ type: "task", task })),
        ...foundReminders.map((reminder) => ({ type: "reminder", reminder })),
      ].slice(0, query.limit ?? 20),
    });
  },

  // ---------- reminders ----------
  listReminders: async (ctx, { query }) => json(200, { reminders: await reminders.listReminders(ctx, query) }),
  getReminder: async (ctx, { params }) => json(200, await reminders.getReminder(ctx, params.id)),
  createReminder: async (ctx, { body }) => json(201, await reminders.createReminder(ctx, body)),
  updateReminder: async (ctx, { params, body }) => json(200, await reminders.updateReminder(ctx, params.id, body)),
  snoozeReminder: async (ctx, { params, body }) => json(200, await reminders.snoozeReminder(ctx, params.id, body)),
  doneReminder: async (ctx, { params }) => json(200, await reminders.doneReminder(ctx, params.id)),
  deleteReminder: async (ctx, { params }) => {
    await reminders.deleteReminder(ctx, params.id);
    return { status: 204 };
  },

  // ---------- push ----------
  getVapidKey: async () => json(200, { publicKey: env().VAPID_PUBLIC_KEY ?? null }),
  pushTest: async (ctx) => {
    const r = await sendNotice(
      ctx.db,
      { title: "Notificación de prueba", body: "Si ves esto, las notificaciones andan. 🎉", url: "/ajustes" },
      { kind: "test", source: "user" },
    );
    return json(200, { ok: r.ok, failed: r.failed });
  },
  pushAction: async (ctx, { body }) => json(200, await applyPushAction(ctx, body)),

  // ---------- API tokens ----------
  listTokens: async (ctx) => json(200, { tokens: await tokens.listTokens(ctx) }),
  createToken: async (ctx, { body }) => json(201, await tokens.createToken(ctx, body)),
  revokeToken: async (ctx, { params }) => {
    await tokens.revokeToken(ctx, params.id);
    return { status: 204 };
  },
};

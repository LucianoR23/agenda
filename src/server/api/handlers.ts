import { eq, sql } from "drizzle-orm";
import { generateOpenApiDocument, withoutExamples } from "@/contract/openapi";
import { audit } from "../auth/audit";
import * as auth from "../auth/auth";
import * as tokens from "../auth/tokens";
import * as calendars from "../calendar/service";
import { getDb } from "../db/client";
import { one } from "../db/one";
import { pushSubscription } from "../db/schema";
import * as assistant from "../domain/assistant";
import { listAudit } from "../domain/audit";
import * as events from "../domain/events";
import * as habits from "../domain/habits";
import { overview } from "../domain/overview";
import { applyPushAction } from "../domain/push-actions";
import * as reminders from "../domain/reminders";
import * as review from "../domain/review";
import { getSettings, updateSettings } from "../domain/settings";
import * as sleep from "../domain/sleep";
import * as stats from "../domain/stats";
import * as tasks from "../domain/tasks";
import { formatInstant } from "../domain/time";
import { env } from "../env";
import { type Handler, json, requireDevice } from "../http/context";
import { sendNotice } from "../push";

let openApiFull: unknown = null;
let openApiCompact: unknown = null;
let openApiSunday: unknown = null;

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

  openapiSunday: async () => {
    openApiSunday ??= { ...withoutExamples(generateOpenApiDocument("sunday")), servers: [{ url: new URL(env().APP_ORIGIN).origin }] };
    return json(200, openApiSunday, { "Cache-Control": "public, max-age=300" });
  },

  // ---------- assistant ----------
  getNow: async (ctx) => json(200, assistant.now(ctx)),
  sendPushNotification: async (ctx, { body }) => json(200, await assistant.notify(ctx, body)),

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
  getAudit: async (ctx, { query }) => json(200, await listAudit(ctx, query)),
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
  createTask: async (ctx, { body }) => {
    const r = await tasks.createTask(ctx, body);
    const at = r.task.dueAt ? Temporal.Instant.from(r.task.dueAt) : null;
    const conflicts = at ? await events.overlapping(ctx, at, null) : null;
    return json(r.created ? 201 : 200, {
      ...r.task,
      ...(r.reminder ? { reminder: r.reminder } : {}),
      ...(conflicts ? { conflicts } : {}),
    });
  },
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
    const foundEvents = await events.searchEvents(ctx, query.q, query.limit);
    return json(200, {
      results: [
        ...foundTasks.map((task) => ({ type: "task", task })),
        ...foundReminders.map((reminder) => ({ type: "reminder", reminder })),
        ...foundEvents.map((event) => ({ type: "event", event })),
      ].slice(0, query.limit ?? 20),
    });
  },

  // ---------- reminders ----------
  listReminders: async (ctx, { query }) => json(200, { reminders: await reminders.listReminders(ctx, query) }),
  getReminder: async (ctx, { params }) => json(200, await reminders.getReminder(ctx, params.id)),
  createReminder: async (ctx, { body }) => {
    const r = await reminders.createReminder(ctx, body);
    return json(r.created ? 201 : 200, r.reminder);
  },
  updateReminder: async (ctx, { params, body }) => json(200, await reminders.updateReminder(ctx, params.id, body)),
  snoozeReminder: async (ctx, { params, body }) => json(200, await reminders.snoozeReminder(ctx, params.id, body)),
  doneReminder: async (ctx, { params }) => json(200, await reminders.doneReminder(ctx, params.id)),
  deleteReminder: async (ctx, { params }) => {
    await reminders.deleteReminder(ctx, params.id);
    return { status: 204 };
  },

  // ---------- events ----------
  getAgendaOverview: async (ctx, { query }) => json(200, await overview(ctx, query)),
  listEvents: async (ctx, { query }) => json(200, { events: await events.listEvents(ctx, query) }),
  getEvent: async (ctx, { params }) => json(200, await events.getEvent(ctx, params.id)),
  createEvent: async (ctx, { body }) => {
    const r = await events.createEvent(ctx, body);
    return json(r.created ? 201 : 200, { ...r.event, conflicts: await events.conflictsOf(ctx, r.event) });
  },
  updateEvent: async (ctx, { params, body }) => {
    const e = await events.updateEvent(ctx, params.id, body);
    return json(200, { ...e, conflicts: await events.conflictsOf(ctx, e) });
  },
  checkAvailability: async (ctx, { query }) => json(200, await events.availability(ctx, query)),
  deleteEvent: async (ctx, { params }) => {
    await events.deleteEvent(ctx, params.id);
    return { status: 204 };
  },
  remindExternalEvent: async (ctx, { params, body }) => json(201, await calendars.remindExternal(ctx, params.id, body)),

  // ---------- habits ----------
  listHabits: async (ctx, { query }) => json(200, { habits: await habits.listHabits(ctx, query) }),
  createHabit: async (ctx, { body }) => json(201, await habits.createHabit(ctx, body)),
  updateHabit: async (ctx, { params, body }) => json(200, await habits.updateHabit(ctx, params.habit, body)),
  deleteHabit: async (ctx, { params }) => {
    await habits.deleteHabit(ctx, params.habit);
    return { status: 204 };
  },
  logHabit: async (ctx, { params, body }) => json(200, await habits.logHabit(ctx, params.habit, body)),
  listHabitLogs: async (ctx, { params, query }) => json(200, { logs: await habits.listHabitLogs(ctx, params.habit, query) }),

  // ---------- sleep ----------
  listSleep: async (ctx, { query }) => json(200, { logs: await sleep.listSleep(ctx, query) }),
  logSleepEvent: async (ctx, { body }) => sleep.sleepEvent(ctx, body),
  upsertSleep: async (ctx, { params, body }) => sleep.upsertSleep(ctx, params.date, body),
  deleteSleep: async (ctx, { params }) => {
    await sleep.deleteSleep(ctx, params.date);
    return { status: 204 };
  },

  // ---------- review, history, metrics ----------
  getDayReview: async (ctx, { params }) => json(200, { review: await review.getReview(ctx, params.date) }),
  saveDayReview: async (ctx, { params, body }) => review.saveReview(ctx, params.date, body),
  getDaySummary: async (ctx, { query }) => json(200, await stats.daySummary(ctx, query)),
  getHistory: async (ctx, { query }) => json(200, await stats.history(ctx, query)),
  getMetrics: async (ctx, { query }) => json(200, await stats.metrics(ctx, query)),

  // ---------- calendars ----------
  getCalendars: async (ctx) => json(200, await calendars.calendarStatus(ctx)),
  updateCalendar: async (ctx, { params, body }) => json(200, await calendars.updateCalendar(ctx, params.id, body)),
  deleteCalendar: async (ctx, { params }) => {
    await calendars.deleteCalendar(ctx, params.id);
    return { status: 204 };
  },
  addIcalCalendar: async (ctx, { body }) => json(201, await calendars.addIcal(ctx, body)),
  syncCalendars: async (ctx, { body }) => json(200, await calendars.syncNow(ctx, body)),
  googleConnect: async (ctx) => calendars.googleConnect(ctx),
  updateGoogleSettings: async (ctx, { body }) => json(200, await calendars.updateGoogleSettings(ctx, body)),
  googleCallback: async (ctx, { query }) => calendars.googleCallback(ctx, query),
  googleDisconnect: async (ctx) => {
    await calendars.googleDisconnect(ctx);
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

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { generateOpenApiDocument, withoutExamples } from "@/contract/openapi";
import * as auth from "../auth/auth";
import { getDb } from "../db/client";
import { pushSubscription, webhookOutbox } from "../db/schema";
import * as blocks from "../domain/blocks";
import * as days from "../domain/days";
import * as insights from "../domain/insights";
import { dayOut, findDay } from "../domain/load";
import { blockOut, habitLogOut, taskOut } from "../domain/serialize";
import * as tracking from "../domain/tracking";
import { env } from "../env";
import { type Ctx, etag, type Handler, json } from "../http/context";
import { addDays, isoLocal, isoLocalOrNull, localDate } from "../time";

const dayResponse = async (ctx: Ctx, date: string, status = 200) => {
  const d = (await findDay(ctx, date))!;
  return json(status, await dayOut(ctx, d), etag(d.version));
};

let openApiFull: unknown = null;
let openApiCompact: unknown = null;

export const handlers: Record<string, Handler> = {
  // ---------- days ----------
  getDay: async (ctx, { params }) => {
    const out = await days.getDay(ctx, params.date);
    return json(200, out, etag(out.version));
  },
  createOwnDay: async (ctx, { params, body }) => {
    await days.createOwnDay(ctx, params.date, body.title);
    return dayResponse(ctx, params.date, 201);
  },
  putDay: async (ctx, { params, query, body }) => days.putDayResponse(ctx, params.date, body, query.mode === "force"),
  patchDay: async (ctx, { params, body }) => {
    await days.patchDay(ctx, params.date, body);
    return dayResponse(ctx, params.date);
  },
  chooseOption: async (ctx, { params, body }) => {
    await days.choose(ctx, params.date, body.option, body.version);
    return dayResponse(ctx, params.date);
  },
  shiftDay: async (ctx, { params, body }) => {
    await days.shift(ctx, params.date, body.fromTime, body.minutes, body.version);
    return dayResponse(ctx, params.date);
  },
  listDays: async (ctx, { query }) => json(200, { days: await insights.listDays(ctx, query.from, query.to) }),

  // ---------- proposals ----------
  listProposals: async (ctx, { params }) => json(200, { proposals: await days.listProposals(ctx, params.date) }),
  acceptProposal: async (ctx, { params }) => {
    await days.acceptProposal(ctx, params.date, params.id);
    return dayResponse(ctx, params.date);
  },
  rejectProposal: async (ctx, { params }) => json(200, await days.rejectProposal(ctx, params.date, params.id)),

  // ---------- blocks ----------
  createBlock: async (ctx, { params, query, body }) => json(201, blockOut(await blocks.createBlock(ctx, params.date, query.option, body))),
  patchBlock: async (ctx, { params, body }) => json(200, blockOut(await blocks.patchBlock(ctx, params.date, params.id, body))),
  patchBlockByExternal: async (ctx, { params, body }) =>
    json(200, { blocks: (await blocks.patchByExternal(ctx, params.date, params.externalId, body)).map(blockOut) }),
  deleteBlock: async (ctx, { params }) => {
    await blocks.deleteBlock(ctx, params.date, params.id);
    return { status: 204 };
  },
  reorderBlocks: async (ctx, { params, body }) => json(200, { blocks: (await blocks.reorderBlocks(ctx, params.date, body.ids, body.version)).map(blockOut) }),

  // ---------- habits & tasks ----------
  listHabits: async (ctx, { query }) => json(200, { habits: await tracking.listHabits(ctx, query.date) }),
  createHabit: async (ctx, { body }) => json(201, tracking.habitOut(await tracking.createHabit(ctx, body))),
  patchHabit: async (ctx, { params, body }) => json(200, tracking.habitOut(await tracking.patchHabit(ctx, params.habit, body))),
  listHabitLogs: async (ctx, { params, query }) => {
    const h = await tracking.findHabit(ctx, params.habit);
    const to = query.to ?? localDate(ctx.now);
    const rows = await tracking.habitLogsOf(ctx, h.id, query.from ?? addDays(to, -29), to);
    return json(200, { logs: rows.map((l) => habitLogOut(l, h.slug)) });
  },
  upsertHabitLog: async (ctx, { params, body }) => {
    const r = await tracking.upsertHabitLog(ctx, params.habit, body);
    return json(r.status, habitLogOut(r.row, r.slug));
  },
  listTasks: async (ctx, { query }) => json(200, { tasks: await tracking.listTasks(ctx, query.date, query.done) }),
  createTask: async (ctx, { body }) => json(201, taskOut(await tracking.createTask(ctx, body))),
  patchTask: async (ctx, { params, body }) => json(200, taskOut(await tracking.patchTask(ctx, params.id, body))),
  deleteTask: async (ctx, { params }) => {
    await tracking.deleteTask(ctx, params.id);
    return { status: 204 };
  },

  // ---------- sleep ----------
  listSleep: async (ctx, { query }) => json(200, { logs: await tracking.listSleep(ctx, query.from, query.to) }),
  logSleepEvent: async (ctx, { body }) => {
    const r = await tracking.sleepEvent(ctx, body);
    return json(r.status, r.body);
  },
  upsertSleep: async (ctx, { params, body }) => {
    const r = await tracking.upsertSleep(ctx, params.date, body);
    return json(r.status, r.body);
  },

  // ---------- insights ----------
  getMetrics: async (ctx, { query }) => json(200, await insights.metrics(ctx, query.range, query.anchor)),
  getAgentContext: async (ctx, { query }) => json(200, await insights.agentContext(ctx, query.date)),
  listChangelog: async (ctx, { query }) => json(200, await insights.listChangelog(ctx, query)),
  exportData: async (ctx) =>
    json(200, await insights.exportAll(ctx), { "Content-Disposition": `attachment; filename="agenda-${ctx.now.toISOString().slice(0, 10)}.json"` }),

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
  closeDay: async (ctx, { body }) => json(200, await days.closePastDays(ctx, body.date)),
  webhookStatus: async (ctx) => {
    const [last] = await ctx.db.select().from(webhookOutbox).orderBy(desc(webhookOutbox.createdAt)).limit(1);
    const queued = await ctx.db.select({ id: webhookOutbox.id }).from(webhookOutbox).where(inArray(webhookOutbox.status, ["collecting", "pending"]));
    const failed = await ctx.db
      .select({ id: webhookOutbox.id })
      .from(webhookOutbox)
      .where(and(eq(webhookOutbox.status, "failed"), gte(webhookOutbox.createdAt, new Date(ctx.now.getTime() - 7 * 86_400_000))));
    return json(200, {
      configured: !!env().AGENT_WEBHOOK_URL,
      lastDelivery: last
        ? {
            batchId: last.id,
            date: last.date,
            status: last.status,
            attempts: last.attempts,
            lastAttemptAt: isoLocalOrNull(last.lastAttemptAt),
            lastResponseStatus: last.lastResponseStatus,
            lastError: last.lastError,
            sentAt: isoLocalOrNull(last.sentAt),
          }
        : null,
      queued: queued.length,
      failedLast7Days: failed.length,
    });
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


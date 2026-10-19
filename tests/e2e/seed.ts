/**
 * E2E seed (run with tsx against the e2e DB): two weeks of history and today's draft, written through the same
 * domain code as the API with controlled timestamps (ctx.now), so lazy close, versions and changelog are real.
 *   tsx tests/e2e/seed.ts history | today | lock-device | agent-replan | agent-title <blockId>
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as ex from "../../src/contract/examples";
import { closeDb, getDb } from "../../src/server/db/client";
import { block, device, habit } from "../../src/server/db/schema";
import { patchBlock } from "../../src/server/domain/blocks";
import { choose, patchDay, putDay } from "../../src/server/domain/days";
import { upsertSleep } from "../../src/server/domain/tracking";
import type { Ctx } from "../../src/server/http/context";
import { addDays, instantAt, localDate } from "../../src/server/time";

const db = getDb();

async function as<T>(caller: "agent" | "user", at: Date, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return db.transaction((tx) =>
    fn({
      requestId: `seed_${randomUUID().slice(0, 8)}`,
      req: new Request("http://seed.local"),
      now: at,
      caller,
      sessionDevice: null,
      sessionLocked: false,
      deviceKey: "",
      ip: null,
      userAgent: "seed",
      ifMatch: null,
      setCookies: [],
      db: tx,
      afterCommit: [],
    }),
  );
}

const today = localDate(new Date());

async function history() {
  await db
    .insert(habit)
    .values([
      { slug: "gym", name: "Gym", kind: "boolean", targetCount: 3, targetPeriod: "week", blockType: "gym", order: 0, updatedBy: "user" },
      { slug: "reading", name: "Lectura", kind: "boolean", targetCount: 1, targetPeriod: "day", blockType: "reading", order: 1, updatedBy: "user" },
    ])
    .onConflictDoNothing();

  const outcomes = ["closed_won", "follow_up", "no_show", "follow_up", "lost", "closed_won", "rescheduled"] as const;
  for (let i = 14; i >= 1; i--) {
    const date = addDays(today, -i);
    await as("agent", instantAt(date, "07:00"), (ctx) => putDay(ctx, date, ex.dayInput0700, false));
    const label = i % 3 === 0 ? "B" : "A";
    await as("user", instantAt(date, "07:40"), (ctx) => choose(ctx, date, label));
    const day = (await db.query.day.findFirst({ where: (d, { eq }) => eq(d.date, date) }))!;
    const mine = await db.select().from(block).where(eq(block.optionId, day.chosenOptionId!));
    let k = 0;
    for (const b of mine) {
      k++;
      const roll = (i * 7 + k * 3) % 10;
      const status: "done" | "skipped" | "pending" = b.type === "sleep" ? "done" : roll < 7 ? "done" : roll < 9 ? "skipped" : "pending";
      if (status === "pending") continue;
      const patch = b.type === "call" ? { status: "done" as const, outcome: outcomes[(i + k) % outcomes.length] } : { status };
      await as("user", instantAt(date, "22:00"), (ctx) => patchBlock(ctx, date, b.id, patch));
    }
    if (i % 2 === 0) await as("user", instantAt(date, "22:30"), (ctx) => patchDay(ctx, date, { review: { energy: 3 + (i % 3), mood: 2 + (i % 4), text: i % 4 === 0 ? "Buen ritmo, cerré una venta." : null } }));
    await as("user", instantAt(addDays(date, 1), "09:00"), (ctx) =>
      upsertSleep(ctx, date, { bedAt: instantAt(date, i % 2 ? "23:50" : "24:20").toISOString(), wokeAt: instantAt(addDays(date, 1), i % 3 ? "07:00" : "06:40").toISOString() }),
    );
  }
}

async function todayDraft() {
  await as("agent", new Date(), (ctx) => putDay(ctx, today, ex.dayInput0700, false));
}

async function lockDevice() {
  // simulate 8 days without using this device → PIN / fingerprint required again
  await db.update(device).set({ lastSeenAt: new Date(Date.now() - 8 * 86_400_000) });
}

async function agentTitle(id: string) {
  await as("agent", new Date(), (ctx) => patchBlock(ctx, today, id, { title: "Lectura: Hábitos atómicos" }));
}

const [cmd, arg] = process.argv.slice(2);
const run = { history, today: todayDraft, "lock-device": lockDevice, "agent-title": () => agentTitle(arg) }[cmd as "history"];
if (!run) throw new Error(`unknown command ${cmd}`);
run()
  .then(() => console.log(`seed ${cmd} ok (${today})`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);

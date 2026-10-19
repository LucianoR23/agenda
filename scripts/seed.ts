/**
 * `pnpm db:seed [YYYY-MM-DD] [--chosen]` — loads a realistic day (the contract's example: two options, calendar calls
 * with leads, store shift, pádel, gym, dogs, reading, sleep), the gym/reading habits, last night's sleep and
 * the WhatsApp checklist. Goes through the same domain code as the API, acting as the agent.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import * as ex from "../src/contract/examples";
import { closeDb, getDb } from "../src/server/db/client";
import { habit, sleepLog } from "../src/server/db/schema";
import { choose, putDay } from "../src/server/domain/days";
import type { Ctx } from "../src/server/http/context";
import { addDays, instantAt, localDate } from "../src/server/time";

async function main() {
  const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localDate();
  const chosen = process.argv.includes("--chosen");
  const db = getDb();

  await db.transaction(async (tx) => {
    const ctx: Ctx = {
      requestId: `seed_${randomUUID().slice(0, 8)}`,
      req: new Request("http://seed.local"),
      now: new Date(),
      caller: "agent",
      sessionDevice: null,
      sessionLocked: false,
      deviceKey: "",
      ip: null,
      userAgent: "seed",
      ifMatch: null,
      setCookies: [],
      db: tx,
      afterCommit: [],
    };
    await tx
      .insert(habit)
      .values([
        { slug: "gym", name: "Gym", kind: "boolean", targetCount: 3, targetPeriod: "week", blockType: "gym", order: 0, updatedBy: "user" },
        { slug: "reading", name: "Lectura", kind: "numeric", unit: "páginas", targetCount: 20, targetPeriod: "day", blockType: "reading", order: 1, updatedBy: "user" },
      ])
      .onConflictDoNothing();
    const r = await putDay(ctx, date, ex.dayInput0700, false);
    console.log(`day ${date}: ${r.result}`);
    if (chosen) {
      await choose({ ...ctx, caller: "user" }, date, "A");
      console.log("option A chosen");
    }
    const night = addDays(date, -1);
    await tx
      .insert(sleepLog)
      .values({ date: night, bedAt: instantAt(night, "24:05"), bedSource: "user", wokeAt: instantAt(date, "06:55"), wakeSource: "user", updatedBy: "user" })
      .onConflictDoNothing();
  });
  console.log("seed done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);

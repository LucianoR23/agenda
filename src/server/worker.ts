import { getDb } from "./db/client";
import { userTimeZone } from "./domain/settings";
import { clock } from "./domain/time";
import { prune } from "./jobs/prune";
import { dailyAt, type Job, Scheduler } from "./jobs/scheduler";
import { log } from "./log";

const TICK_MS = 30_000;

/** Jobs of the in-process worker (single replica). Phase 5 adds the reminder dispatcher and event offsets. */
export const JOBS: Job[] = [{ name: "prune", due: dailyAt("04:00"), run: (now) => prune(getDb(), now) }];

let started = false;
let running = false;

export function startWorker() {
  if (started) return;
  started = true;
  const scheduler = new Scheduler(JOBS, { now: () => clock().now() }, () => userTimeZone(getDb()));
  setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await scheduler.tick();
    } catch (err) {
      log.error("worker tick failed", { err });
    } finally {
      running = false;
    }
  }, TICK_MS).unref();
  log.info("worker started", { tickSeconds: TICK_MS / 1000, jobs: JOBS.map((j) => j.name) });
}

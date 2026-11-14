import { getDb } from "./db/client";
import { userTimeZone } from "./domain/settings";
import { clock } from "./domain/time";
import { prune } from "./jobs/prune";
import { dispatchReminders } from "./jobs/reminders";
import { dailyAt, type Job, Scheduler } from "./jobs/scheduler";
import { log } from "./log";

/** docs/v2/05: reminders are checked every 15 s. */
const TICK_MS = 15_000;

/** Jobs of the in-process worker (single replica). Event offsets (phase 6) and calendar sync join later. */
export const JOBS: Job[] = [
  // every tick; the first one at boot is the catch-up for anything that came due while the server was down
  { name: "reminders", due: () => true, run: (now) => dispatchReminders(getDb(), now) },
  { name: "prune", due: dailyAt("04:00"), run: (now) => prune(getDb(), now) },
];

let started = false;
let running = false;

export function startWorker() {
  if (started) return;
  started = true;
  const scheduler = new Scheduler(JOBS, { now: () => clock().now() }, () => userTimeZone(getDb()));
  const tick = async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await scheduler.tick();
    } catch (err) {
      log.error("worker tick failed", { err });
    } finally {
      running = false;
    }
  };
  void tick(); // catch-up right away, not 15 s later
  setInterval(tick, TICK_MS).unref();
  log.info("worker started", { tickSeconds: TICK_MS / 1000, jobs: JOBS.map((j) => j.name) });
}

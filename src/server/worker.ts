import { pushToGoogle } from "./calendar/push";
import { syncCalendars } from "./calendar/sync";
import { getDb } from "./db/client";
import { materializeEventReminders } from "./domain/event-reminders";
import { userTimeZone } from "./domain/settings";
import { clock } from "./domain/time";
import { prune } from "./jobs/prune";
import { dispatchReminders } from "./jobs/reminders";
import { dailyAt, every, type Job, Scheduler } from "./jobs/scheduler";
import { log } from "./log";

/** docs/v2/05: reminders are checked every 15 s. */
const TICK_MS = 15_000;

/** Jobs of the in-process worker (single replica). */
export const JOBS: Job[] = [
  // every tick; the first one at boot is the catch-up for anything that came due while the server was down
  { name: "reminders", due: () => true, run: (now) => dispatchReminders(getDb(), now) },
  // "30 min antes" reminders for the next 48 h (writes also materialize right away)
  { name: "event-reminders", due: every(5), run: (now) => materializeEventReminders(getDb(), now) },
  // each calendar decides if it's due (Google 5 min, iCal 15 min, backoff after errors); detached so a slow Google
  // never delays a reminder tick (syncCalendars never overlaps itself)
  {
    name: "calendar-sync",
    due: every(1),
    run: async (now) => {
      void syncCalendars(getDb(), now).catch((err) => log.error("calendar sync failed", { err }));
    },
  },
  // local events -> the "Agenda" calendar in Google (when turned on); detached like the sync
  {
    name: "google-push",
    due: every(1),
    run: async (now) => {
      void pushToGoogle(getDb(), now).catch((err) => log.error("google push failed", { err }));
    },
  },
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

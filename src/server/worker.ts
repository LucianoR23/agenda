import { tick } from "./jobs";

const INTERVAL_MS = 30_000;
let started = false;
let running = false;

/** In-process background loop (D59): webhook delivery, block reminders, sleep reminder. One container only. */
export function startWorker() {
  if (started) return;
  started = true;
  setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await tick(new Date());
    } finally {
      running = false;
    }
  }, INTERVAL_MS).unref();
  console.log("agenda worker started (every 30 s)");
}

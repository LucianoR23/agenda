import { deliverDueWebhooks, tick } from "./jobs";

const INTERVAL_MS = 30_000;
let started = false;
let running = false;

/** In-process background loop (D59): webhook delivery, block reminders, sleep reminder. One container only. */
export function startWorker() {
  if (started) return;
  started = true;
  (globalThis as { __agendaWorker?: boolean }).__agendaWorker = true;
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

/**
 * Delivers due webhooks now (immediate events: adjustment requests, choose, proposal accept/reject) instead of
 * waiting up to 30 s for the next tick. Only where the worker runs (a global flag: instrumentation and route
 * handlers are separate bundles); a no-op in tests. Overlapping a tick is safe: each row is claimed atomically.
 */
export function kickWebhooks() {
  if (!(globalThis as { __agendaWorker?: boolean }).__agendaWorker) return;
  void deliverDueWebhooks(new Date()).catch((e) => console.error("webhook delivery", e));
}

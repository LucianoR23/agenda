/**
 * Node runtime boot: validates the environment (a bad config stops the server with a clear message, never printing
 * values), then starts the background worker unless DISABLE_WORKER is set.
 */
import { env } from "./server/env";
import { log } from "./server/log";

let e: ReturnType<typeof env>;
try {
  e = env();
} catch (err) {
  // Next keeps serving (with every request failing) when the hook throws: stop the process instead, so the
  // container restarts visibly and Coolify shows the reason. The message names variables, never values.
  log.error("invalid configuration, exiting", { reason: (err as Error).message });
  process.exit(1);
}
log.info("agenda starting", { version: e.APP_VERSION, nodeEnv: e.NODE_ENV, worker: !e.DISABLE_WORKER });
if (!e.DISABLE_WORKER) {
  const { startWorker } = await import("./server/worker");
  startWorker();
}

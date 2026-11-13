/**
 * Runs once per server start (Node runtime only): validates the environment (a bad config stops the server with
 * a clear message, never printing values), then starts the background worker unless DISABLE_WORKER is set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./server/env");
  const { log } = await import("./server/log");
  const e = env();
  log.info("agenda starting", { version: e.APP_VERSION, nodeEnv: e.NODE_ENV, worker: !e.DISABLE_WORKER });
  if (e.DISABLE_WORKER) return;
  const { startWorker } = await import("./server/worker");
  startWorker();
}

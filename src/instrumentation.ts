/** Runs once per server start: starts the background worker (Node runtime only; DISABLE_WORKER=1 turns it off). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_WORKER === "1") return;
  const { startWorker } = await import("./server/worker");
  startWorker();
}

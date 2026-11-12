let started = false;

/**
 * In-process background loop, one container only. v1 jobs (Agenbot webhooks, block reminders, sleep reminder) are
 * gone; phase 5 rebuilds this as the durable reminder scheduler (see docs/v2/05-reminders-and-push.md).
 */
export function startWorker() {
  if (started) return;
  started = true;
}

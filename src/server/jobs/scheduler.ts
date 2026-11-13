import type { Clock } from "../domain/time";
import { dateOf, timeOf } from "../domain/time";
import { log } from "../log";

/** A background job. `due` decides from the clock, the user's timezone and the last run. */
export interface Job {
  name: string;
  due(now: Temporal.Instant, tz: string, lastRun: Temporal.Instant | null): boolean;
  run(now: Temporal.Instant): Promise<unknown>;
}

/** Once a day at or after `HH:mm` local time (a missed run catches up on the next tick). */
export const dailyAt =
  (hhmm: string) =>
  (now: Temporal.Instant, tz: string, lastRun: Temporal.Instant | null): boolean =>
    timeOf(now, tz) >= hhmm && (lastRun === null || dateOf(lastRun, tz) < dateOf(now, tz));

/** Every `minutes` minutes. */
export const every =
  (minutes: number) =>
  (now: Temporal.Instant, _tz: string, lastRun: Temporal.Instant | null): boolean =>
    lastRun === null || lastRun.until(now).total("minutes") >= minutes;

/** Runs every due job once, sequentially; a failing job is logged and doesn't stop the others. */
export class Scheduler {
  private readonly lastRuns = new Map<string, Temporal.Instant>();
  constructor(
    private readonly jobs: Job[],
    private readonly clock: Clock,
    private readonly timezone: () => Promise<string>,
  ) {}

  async tick(): Promise<string[]> {
    const now = this.clock.now();
    const tz = await this.timezone();
    const ran: string[] = [];
    for (const job of this.jobs) {
      if (!job.due(now, tz, this.lastRuns.get(job.name) ?? null)) continue;
      this.lastRuns.set(job.name, now);
      try {
        const result = await job.run(now);
        log.info("job done", { job: job.name, result });
        ran.push(job.name);
      } catch (err) {
        log.error("job failed", { job: job.name, err });
      }
    }
    return ran;
  }
}

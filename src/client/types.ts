import type { z } from "zod";
import type * as P from "@/contract/planning";
import type * as Sl from "@/contract/sleep";
import type * as Sy from "@/contract/system";
import type * as T from "@/contract/tracking";

export type Day = z.infer<typeof P.Day>;
export type Block = z.infer<typeof P.Block>;
export type PlanOption = z.infer<typeof P.PlanOption>;
export type Task = z.infer<typeof P.Task>;
export type Proposal = z.infer<typeof P.Proposal>;
export type DaySummary = z.infer<typeof P.DaySummary>;
export type BlockType = z.infer<typeof P.BlockType>;
export type CallOutcome = z.infer<typeof P.CallOutcome>;
export type HabitProgress = z.infer<typeof T.HabitProgress>;
export type Metrics = z.infer<typeof T.Metrics>;
export type SleepLog = z.infer<typeof Sl.SleepLog>;
export type SessionState = z.infer<typeof Sy.SessionState>;
export type Device = z.infer<typeof Sy.Device>;
export type WebhookStatus = z.infer<typeof Sy.WebhookStatus>;

export interface Problem {
  status: number;
  code?: string;
  title: string;
  detail?: string;
  current?: unknown;
  errors?: Array<{ path: string; message: string }>;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
}

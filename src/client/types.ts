import type { z } from "zod";
import type * as Sy from "@/contract/system";

export type SessionState = z.infer<typeof Sy.SessionState>;
export type Device = z.infer<typeof Sy.Device>;

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

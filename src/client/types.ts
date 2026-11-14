import type { z } from "zod";
import type * as Sy from "@/contract/system";
import type * as Tk from "@/contract/tasks";

export type SessionState = z.infer<typeof Sy.SessionState>;
export type Device = z.infer<typeof Sy.Device>;
export type Settings = z.infer<typeof Sy.Settings>;
export type ApiToken = z.infer<typeof Sy.ApiToken>;
export type TokenCreated = z.infer<typeof Sy.TokenCreated>;
export type TokenScope = z.infer<typeof Sy.TokenScope>;
export type Task = z.infer<typeof Tk.Task>;
export type TaskList = z.infer<typeof Tk.TaskList>;
export type TaskQuery = z.infer<typeof Tk.TaskQuery>;
export type TaskCreate = z.infer<typeof Tk.TaskCreate>;
export type TaskPatch = z.infer<typeof Tk.TaskPatch>;
export type CompleteResult = z.infer<typeof Tk.CompleteResult>;

/** A failed API call: the server's `{ error: { code, message, details } }` plus the HTTP status. */
export interface Problem {
  status: number;
  code?: string | undefined;
  /** Spanish, ready to show. */
  message: string;
  details?: Record<string, unknown> | undefined;
}

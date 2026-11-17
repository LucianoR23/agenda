import type { z } from "zod";
import type * as Ev from "@/contract/events";
import type * as Ov from "@/contract/overview";
import type * as Rm from "@/contract/reminders";
import type * as Sy from "@/contract/system";
import type * as Tk from "@/contract/tasks";
import type * as Tr from "@/contract/tracking";

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
export type Reminder = z.infer<typeof Rm.Reminder>;
export type ReminderQuery = z.infer<typeof Rm.ReminderQuery>;
export type Event = z.infer<typeof Ev.Event>;
export type AgendaEvent = z.infer<typeof Ev.AgendaEvent>;
export type EventQuery = z.infer<typeof Ev.EventQuery>;
export type CalendarStatus = z.infer<typeof Ev.CalendarStatus>;
export type CalendarSource = z.infer<typeof Ev.CalendarSource>;
export type Overview = z.infer<typeof Ov.Overview>;
export type Habit = z.infer<typeof Tr.Habit>;
export type HabitProgress = z.infer<typeof Tr.HabitProgress>;
export type HabitQuery = z.infer<typeof Tr.HabitQuery>;
export type SleepLog = z.infer<typeof Tr.SleepLog>;
export type DayReview = z.infer<typeof Tr.DayReview>;
export type DaySummary = z.infer<typeof Tr.DaySummary>;
export type History = z.infer<typeof Tr.History>;
export type Metrics = z.infer<typeof Tr.Metrics>;

/** A failed API call: the server's `{ error: { code, message, details } }` plus the HTTP status. */
export interface Problem {
  status: number;
  code?: string | undefined;
  /** Spanish, ready to show. */
  message: string;
  details?: Record<string, unknown> | undefined;
}

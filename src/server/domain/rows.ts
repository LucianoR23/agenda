import type * as s from "../db/schema";

export type DayRow = typeof s.day.$inferSelect;
export type OptionRow = typeof s.planOption.$inferSelect;
export type BlockRow = typeof s.block.$inferSelect;
export type NewBlock = typeof s.block.$inferInsert;
export type TaskRow = typeof s.task.$inferSelect;
export type HabitRow = typeof s.habit.$inferSelect;
export type HabitLogRow = typeof s.habitLog.$inferSelect;
export type ProposalRow = typeof s.proposal.$inferSelect;
export type AdjustmentRow = typeof s.adjustment.$inferSelect;
export type SleepRow = typeof s.sleepLog.$inferSelect;
export type DeviceRow = typeof s.device.$inferSelect;
export type ChangeLogRow = typeof s.changeLog.$inferSelect;

import type * as s from "../db/schema";

export type DeviceRow = typeof s.device.$inferSelect;
export type ChangeLogRow = typeof s.changeLog.$inferSelect;

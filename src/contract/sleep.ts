import { BlockTime, ExpectedVersion, LocalDate, Mutable, orNull, Timestamp, Uuid } from "./common";
import { z } from "./zod";

const SleepSource = z.enum(["agent", "user"]).openapi("SleepSource");

export const SleepLog = z
  .strictObject({
    id: Uuid,
    date: LocalDate.openapi({ description: "The night that starts on this day (bed on this date's evening or after midnight)." }),
    bedAt: orNull(Timestamp).openapi({ description: "When I actually went to bed." }),
    bedSource: orNull(SleepSource),
    wokeAt: orNull(Timestamp).openapi({ description: "When I actually got up." }),
    wakeSource: orNull(SleepSource),
    durationMinutes: z.int().nullable().openapi({ description: "wokeAt − bedAt, when both are set." }),
    plannedStart: orNull(BlockTime).openapi({ description: "Start of the `sleep` block in the chosen option, if any." }),
    plannedEnd: orNull(BlockTime),
    bedDelayMinutes: z.int().nullable().openapi({ description: "bedAt − planned start (positive = later than planned)." }),
    note: z.string().nullable(),
    ...Mutable,
  })
  .openapi("SleepLog", {
    description:
      "Actual sleep for one night. Setting `bedAt` also marks that day's pending `sleep` block as done. The agent may only fill a half (bed / wake) that is still empty.",
  });

export const SleepUpsert = z
  .strictObject({
    bedAt: orNull(Timestamp).optional(),
    wokeAt: orNull(Timestamp).optional(),
    note: z.string().max(1000).nullable().optional(),
    version: ExpectedVersion,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "version"), "At least one field to change is required")
  .refine((b) => !b.bedAt || !b.wokeAt || Date.parse(b.wokeAt) > Date.parse(b.bedAt), {
    path: ["wokeAt"],
    message: "Must be after bedAt",
  })
  .openapi("SleepUpsert", { description: "Manual load or correction. Times may not be in the future; the night lasts < 20 h." });

export const SleepEvent = z
  .strictObject({
    type: z.enum(["bed", "wake"]).openapi({ description: "`bed` = \"Me voy a dormir\", `wake` = \"Me levanté\"." }),
    at: Timestamp.optional().openapi({ description: "Default: now. Lets me (or the agent) back-date: \"me dormí a las 00:20\"." }),
  })
  .openapi("SleepEvent", {
    description:
      "Quick button / agent shortcut. The night is resolved from the time: before 12:00 → the previous day's night, otherwise today's.",
  });

/** Both nights shown on "Hoy": tonight (this day) and the one that just ended (previous day). */
export const DaySleep = z
  .strictObject({
    night: orNull(SleepLog).openapi({ description: "Sleep for the night starting on this day." }),
    previousNight: orNull(SleepLog).openapi({ description: "Last night; incomplete → \"¿A qué hora te dormiste / levantaste?\" card." }),
  })
  .openapi("DaySleep");

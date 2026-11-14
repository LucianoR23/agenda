import { LocalDate } from "./common";
import { AgendaEvent } from "./events";
import { Reminder } from "./reminders";
import { Task } from "./tasks";
import { z } from "./zod";

export const OverviewQuery = z
  .strictObject({
    from: LocalDate.optional().openapi({ description: "Default today." }),
    to: LocalDate.optional().openapi({ description: "Default `from`. At most 31 days after `from`." }),
  })
  .openapi("OverviewQuery");

export const Overview = z
  .strictObject({
    from: LocalDate,
    to: LocalDate,
    events: z.array(AgendaEvent).openapi({ description: "Local + Google/iCal, chronological (all-day first each day)." }),
    tasks: z.array(Task).openapi({ description: "Open tasks due in the range, by date and time." }),
    reminders: z.array(Reminder).openapi({ description: "Reminders firing in the range, chronological." }),
    overdue: z.array(Task).openapi({ description: "Open tasks due before `from`." }),
  })
  .openapi("Overview");

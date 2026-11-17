import { LocalDate, LocalTime, Timestamp } from "./common";
import { z } from "./zod";

/**
 * Operations published in `openapi.sunday.json`, the spec Open WebUI loads as Sunday's tools. Every one must allow
 * API tokens (`token` scope on its route). Auth, devices, settings, calendars admin and habit setup stay app-only.
 */
export const SUNDAY_OPERATIONS = [
  // context
  "getNow",
  "getAgendaOverview",
  "searchAgenda",
  // tasks
  "listTasks",
  "getTask",
  "createTask",
  "updateTask",
  "completeTask",
  "reopenTask",
  "deleteTask",
  "listTaskLists",
  "createTaskList",
  // reminders
  "listReminders",
  "getReminder",
  "createReminder",
  "updateReminder",
  "snoozeReminder",
  "doneReminder",
  "deleteReminder",
  // events
  "listEvents",
  "checkAvailability",
  "getEvent",
  "createEvent",
  "updateEvent",
  "deleteEvent",
  "remindExternalEvent",
  // habits, sleep, day
  "listHabits",
  "logHabit",
  "listHabitLogs",
  "listSleep",
  "logSleepEvent",
  "upsertSleep",
  "getDaySummary",
  "getDayReview",
  "saveDayReview",
  "getHistory",
  "getMetrics",
  // push
  "sendPushNotification",
] as const;

export type SundayOperation = (typeof SUNDAY_OPERATIONS)[number];

/**
 * How the model should use each tool: appended to the operation's description in both specs. Plain, short, in the
 * model's terms ("Lemy", what to call before or after). The route's own description covers the mechanics.
 */
export const SUNDAY_GUIDE: Record<SundayOperation, string> = {
  getNow: "",
  getAgendaOverview:
    "The first call for any '¿qué tengo…?' question. Pass from/to for other days (to inclusive). Read times back with each item's `whenText`. Overdue tasks come apart in `overdue`.",
  searchAgenda:
    "Use it to find the id of something Lemy names by title ('la del contador') before updating, completing or deleting it. Covers tasks, reminders and Lemy's own events; Google Calendar events are found with listEvents. If several match, ask which one.",
  listTasks:
    "For task-only questions ('¿qué tengo pendiente?', 'tareas de Casa', 'lo que hice ayer' with view=done). For a day's full picture prefer getAgendaOverview.",
  getTask: "Fetch one task by id (after a search) to check its current state.",
  createTask:
    "A to-do. Without a date it goes to the Inbox. `dueDate` can be a date or a date-time ('mañana a las 9' → `2026-11-15T09:00`). `list` takes the list's name. `reminderAt` also schedules a push. Always send a `clientId`. For a push at a moment with nothing to do afterwards, createReminder fits better; for something with a start and end, createEvent. A task with a time returns `conflicts` (events at that moment): mention them.",
  updateTask:
    "Reschedule ('pasala al viernes'), rename, move to another list (`list` by name) or cancel (`status: cancelled`). Only send the fields that change. Get the id with searchAgenda first.",
  completeTask: "When Lemy says he did it. A recurring task returns `next`, its next occurrence: mention when it comes back.",
  reopenTask: "Undo a completion ('no, no la terminé').",
  deleteTask:
    "Only when Lemy asks to delete or forget it. If it was done, use completeTask; if he won't do it, updateTask with status cancelled.",
  listTaskLists: "The lists and their names, to pick `list` for createTask/updateTask.",
  createTaskList: "Only when Lemy asks for a new list.",
  listReminders: "view=upcoming for the pending ones ('¿qué recordatorios tengo?'), view=recent for what already fired. Without view: all.",
  getReminder: "Fetch one reminder by id.",
  createReminder:
    "A push notification at a moment ('recordame a las 18 sacar la ropa'). `fireAt` can omit the offset: it's Lemy's local time. Must be in the future. `rrule` for repeating ones (`FREQ=DAILY`), `urgent` to ignore quiet hours. Always send a `clientId`.",
  updateReminder: "Change the time or text of a reminder. A new future time re-arms one that already fired.",
  snoozeReminder: "'Recordámelo en media hora' about an existing reminder: `minutes`, or `until` a time.",
  doneReminder: "Lemy confirms he did what the reminder asked (the linked task is completed too).",
  deleteReminder: "Cancel a reminder Lemy no longer wants.",
  listEvents:
    "Calendar only (Lemy's events plus Google Calendar) for a range up to 92 days. Google events have `readOnly: true`: they can't be changed here, only get a reminder with remindExternalEvent.",
  checkAvailability:
    "'¿Tengo algo el jueves a las 15?', or before proposing a time: whether a slot is free, and what's there if not. Times can omit the offset.",
  getEvent: "Fetch one of Lemy's own events by id.",
  createEvent:
    "Something with a time slot or a whole day ('turno con el dentista el miércoles a las 10'). Times can omit the offset. `reminderOffsets: [60]` pushes 1 h before. Always send a `clientId`. It's created in the agenda, not in Google Calendar. If the response's `conflicts` isn't empty, tell Lemy ('ojo, a esa hora ya tenés la daily') and offer to move it; don't move it on your own.",
  updateEvent:
    "Move or edit one of Lemy's own events (the whole series if it repeats). A Google Calendar event answers READ_ONLY_EVENT: tell Lemy to change it in Google Calendar. Like createEvent, mention any `conflicts` in the response.",
  deleteEvent: "Delete one of Lemy's own events. Google Calendar events can't be deleted here.",
  remindExternalEvent:
    "'Avisame 15 minutos antes de la daily': a reminder for a Google Calendar event (its `externalEventId` from getAgendaOverview or listEvents).",
  listHabits: "Habits with today's check, the week's progress and streaks ('¿cómo vengo con el gym?').",
  logHabit:
    "'Fui al gym', 'leí 20 páginas': `{habit}` is the slug (gym, lectura) or the id; listHabits shows them. Yes/no habits take nothing (or `done: false` to uncheck); numeric ones take `value`. Back-date with `date`.",
  listHabitLogs: "A habit's history over a range.",
  listSleep: "Nights over a range ('¿cómo dormí esta semana?'). Each night belongs to the date Lemy woke up.",
  logSleepEvent: "'Me voy a dormir' → `type: bed`; 'me levanté' → `type: wake`. Now by default, or `at` ('me dormí a las 0:30').",
  upsertSleep: "Load or fix a whole night at once, with `quality` 1–5. `{date}` is the wake-up date.",
  getDaySummary: "Everything about one day (tasks done and pending, habits, sleep, review): the base for an evening review.",
  getDayReview: "The day's closing review if Lemy already did it.",
  saveDayReview:
    "Close the day with Lemy: mood 1–5, up to 3 highlights, a note, and `moves` for each pending task (tomorrow, inbox or drop = cancel). Get the pending ones from getDaySummary first.",
  getHistory: "Per-day numbers for a month (tasks done, habits met, sleep, mood).",
  getMetrics: "Trends for a week, month or year: completion, punctuality, habit consistency, sleep and mood averages.",
  sendPushNotification: "",
};

export const Now = z
  .strictObject({
    now: Timestamp,
    date: LocalDate.openapi({ description: "Today in the user's timezone." }),
    time: LocalTime,
    weekday: z.string().openapi({ description: "In Spanish.", example: "jueves" }),
    whenText: z.string().openapi({ example: "jueves 14 de noviembre, 09:12" }),
    timezone: z.string().openapi({ example: "America/Buenos_Aires" }),
    utcOffset: z.string().openapi({ example: "-03:00" }),
    tomorrow: LocalDate,
    weekStart: LocalDate.openapi({ description: "Monday of this week." }),
    weekEnd: LocalDate.openapi({ description: "Sunday of this week." }),
  })
  .openapi("Now");

export const NotifyInput = z
  .strictObject({
    title: z.string().trim().min(1).max(60),
    body: z.string().trim().min(1).max(240),
    url: z.string().trim().max(500).optional().openapi({
      description:
        "Opened on tap. An https link on sunday.lemydev.com or agenda.lemydev.com, or an app path like `/tareas`. Default: the app.",
      example: "https://sunday.lemydev.com/c/019a0a6e",
    }),
    tag: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .openapi({ description: "Same tag replaces the previous notification instead of stacking.", example: "resumen-noche" }),
  })
  .openapi("NotifyInput");

export const NotifyResult = z
  .strictObject({
    delivered: z.int().openapi({ description: "Devices that accepted it (0: no device subscribed or all offline)." }),
    failed: z.int(),
    remainingToday: z.int().openapi({ description: "Pushes left in the 24-hour window (20)." }),
  })
  .openapi("NotifyResult");

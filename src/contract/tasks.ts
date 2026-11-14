import { ExpectedVersion, ItemSource, LocalDate, LocalTime, Mutable, orNull, Timestamp, Uuid } from "./common";
import { z } from "./zod";

// ---------- lists ----------

export const TaskList = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    color: z.string().nullable(),
    icon: z.string().nullable(),
    sortOrder: z.int(),
    isInbox: z.boolean().openapi({ description: "The default list. Exactly one; can't be deleted." }),
    openCount: z.int().openapi({ description: "Open tasks in the list." }),
    ...Mutable,
  })
  .openapi("TaskList");

const ListName = z.string().trim().min(1).max(80);
const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected #RRGGBB")
  .openapi({ example: "#7ccfa5" });

export const TaskListCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated id (offline creates)." }),
    name: ListName,
    color: Color.optional(),
    icon: z.string().max(40).optional(),
  })
  .openapi("TaskListCreate");

export const TaskListPatch = z
  .strictObject({
    name: ListName.optional(),
    color: Color.nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
    sortOrder: z.int().optional(),
    version: ExpectedVersion,
  })
  .openapi("TaskListPatch");

// ---------- tasks ----------

export const TaskStatus = z.enum(["open", "done", "cancelled"]).openapi("TaskStatus");
export const Priority = z.int().min(0).max(3).openapi("Priority", { description: "0 none · 1 low · 2 medium · 3 high." });
const Title = z.string().trim().min(1).max(500);
const Tag = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\s#]+$/, "Tags have no spaces or #");
const Rrule = z
  .string()
  .max(300)
  .openapi({ description: "RFC 5545 RRULE body without DTSTART (the due date is the start).", example: "FREQ=WEEKLY;BYDAY=MO" });

export const Task = z
  .strictObject({
    id: Uuid,
    listId: Uuid,
    title: z.string(),
    notes: z.string().nullable(),
    status: TaskStatus,
    priority: Priority,
    dueDate: orNull(LocalDate),
    dueTime: orNull(LocalTime).openapi({ description: "Local time in the user's timezone; only with dueDate." }),
    dueAt: orNull(Timestamp).openapi({ description: "dueDate + dueTime as an instant (null without a time)." }),
    overdue: z.boolean().openapi({ description: "Open and due before today (user's timezone)." }),
    rrule: Rrule.nullable(),
    seriesId: orNull(Uuid).openapi({ description: "Shared by every occurrence of a recurring task." }),
    completedAt: orNull(Timestamp),
    sortOrder: z.int(),
    tags: z.array(z.string()),
    source: ItemSource,
    ...Mutable,
  })
  .openapi("Task");

export const TaskCreate = z
  .strictObject({
    id: Uuid.optional().openapi({ description: "Client-generated id (offline creates). Reusing an existing id is a 409." }),
    title: Title,
    notes: z.string().max(10_000).optional(),
    listId: Uuid.optional().openapi({ description: "Default: Inbox." }),
    priority: Priority.optional(),
    dueDate: LocalDate.optional(),
    dueTime: LocalTime.optional(),
    rrule: Rrule.optional(),
    tags: z.array(Tag).max(20).optional(),
  })
  .openapi("TaskCreate");

export const TaskPatch = z
  .strictObject({
    title: Title.optional(),
    notes: z.string().max(10_000).nullable().optional(),
    listId: Uuid.optional(),
    priority: Priority.optional(),
    dueDate: orNull(LocalDate).optional().openapi({ description: "null removes the date (and the time and recurrence)." }),
    dueTime: orNull(LocalTime).optional(),
    rrule: Rrule.nullable().optional(),
    tags: z.array(Tag).max(20).optional(),
    status: z.enum(["open", "cancelled"]).optional().openapi({ description: "Use completeTask to mark done." }),
    version: ExpectedVersion,
  })
  .openapi("TaskPatch");

export const TaskView = z.enum(["inbox", "today", "upcoming", "overdue", "done", "all"]).openapi("TaskView", {
  description:
    "`inbox`: open, no date, in the Inbox. `today`: open, due today. `upcoming`: open, due after today. `overdue`: open, due before today. `done`: completed, newest first. `all`: no view filter.",
});

export const TaskQuery = z
  .strictObject({
    view: TaskView.optional(),
    listId: Uuid.optional(),
    tag: z.string().max(40).optional(),
    status: TaskStatus.optional(),
    dueFrom: LocalDate.optional(),
    dueTo: LocalDate.optional(),
    q: z.string().max(200).optional().openapi({ description: "Text search over title and notes (accent-insensitive)." }),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .openapi("TaskQuery");

export const CompleteResult = z
  .strictObject({
    task: Task,
    next: orNull(Task).openapi({ description: "The next occurrence, when the task repeats." }),
  })
  .openapi("CompleteResult");

export const ReorderInput = z.strictObject({ ids: z.array(Uuid).min(1).max(500) }).openapi("ReorderInput");

export const SearchResult = z
  .strictObject({
    results: z.array(z.strictObject({ type: z.literal("task"), task: Task })),
  })
  .openapi("SearchResult");

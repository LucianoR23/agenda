"use client";

import { useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { todayLocal, userTimeZone } from "@/ui/time";
import { enqueue } from "./sync";
import type { Task, TaskList, TaskPatch } from "./types";

const REFRESH = [JSON.stringify(["tasks"]), JSON.stringify(["lists"])];

/** Local copy of the server's derived fields, so an optimistic task renders like a fetched one. */
function derive(t: Task): Task {
  const today = todayLocal();
  const dueAt =
    t.dueDate && t.dueTime
      ? Temporal.PlainDate.from(t.dueDate)
          .toPlainDateTime(Temporal.PlainTime.from(t.dueTime))
          .toZonedDateTime(userTimeZone(), { disambiguation: "compatible" })
          .toString({ timeZoneName: "never", smallestUnit: "millisecond" })
      : null;
  return { ...t, dueAt, overdue: t.status === "open" && !!t.dueDate && t.dueDate < today };
}

const nowIso = () => Temporal.Now.zonedDateTimeISO(userTimeZone()).toString({ timeZoneName: "never", smallestUnit: "millisecond" });

export interface NewTask {
  title: string;
  notes?: string;
  listId?: string;
  priority?: number;
  dueDate?: string | null;
  dueTime?: string | null;
  rrule?: string | null;
  tags?: string[];
}

/**
 * Task writes. Every one is optimistic and goes through the outbox (offline-safe, replayed with its Idempotency-Key);
 * new tasks get their id here (UUIDv7), so they can be edited or completed before reaching the server.
 */
export function useTaskActions() {
  const qc = useQueryClient();
  const inboxId = () => qc.getQueryData<{ lists: TaskList[] }>(["lists"])?.lists.find((l) => l.isInbox)?.id ?? "";

  return {
    create(input: NewTask) {
      const id = uuidv7();
      const at = nowIso();
      const task = derive({
        id,
        listId: input.listId ?? inboxId(),
        title: input.title,
        notes: input.notes ?? null,
        status: "open",
        priority: input.priority ?? 0,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        dueAt: null,
        whenText: null,
        overdue: false,
        rrule: input.rrule ?? null,
        seriesId: null,
        completedAt: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        tags: input.tags ?? [],
        source: "user",
        url: "",
        version: 1,
        createdAt: at,
        updatedAt: at,
        updatedBy: "user",
      });
      const body = Object.fromEntries(Object.entries({ id, ...input }).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      void enqueue(qc, {
        method: "POST",
        path: "/api/tasks",
        body,
        invalidate: REFRESH,
        optimistic: { kind: "task-put", task },
        label: "Tarea nueva",
      });
      return task;
    },

    update(t: Task, patch: Omit<TaskPatch, "version">) {
      const next = derive({
        ...t,
        ...patch,
        ...(patch.dueDate === null ? { dueTime: null, rrule: null } : {}),
        version: t.version + 1,
      } as Task);
      void enqueue(qc, {
        method: "PATCH",
        path: `/api/tasks/${t.id}`,
        body: { ...patch, version: t.version },
        invalidate: REFRESH,
        optimistic: { kind: "task-put", task: next },
        label: "Tarea",
      });
      return next;
    },

    complete(t: Task) {
      const done = derive({ ...t, status: "done", completedAt: nowIso(), version: t.version + 1 });
      void enqueue(qc, {
        method: "POST",
        path: `/api/tasks/${t.id}/complete`,
        body: { version: t.version },
        invalidate: REFRESH,
        optimistic: { kind: "task-put", task: done },
        label: "Tarea completada",
      });
      return done;
    },

    /** Undo a completion; the server also removes the occurrence it spawned. */
    reopen(t: Task) {
      const open = derive({ ...t, status: "open", completedAt: null, version: t.version + 1 });
      void enqueue(qc, {
        method: "POST",
        path: `/api/tasks/${t.id}/reopen`,
        body: {},
        invalidate: REFRESH,
        optimistic: { kind: "task-put", task: open },
        label: "Deshacer",
      });
      return open;
    },

    remove(t: Task) {
      void enqueue(qc, {
        method: "DELETE",
        path: `/api/tasks/${t.id}`,
        body: undefined,
        invalidate: REFRESH,
        optimistic: { kind: "task-remove", id: t.id },
        label: "Tarea borrada",
      });
    },

    reorder(ids: string[]) {
      void enqueue(qc, { method: "POST", path: "/api/tasks/reorder", body: { ids }, invalidate: REFRESH, label: "Orden" });
    },
  };
}

import type { Task, TaskQuery } from "./types";

/**
 * Client-side mirror of the server's task views, so optimistic edits (and offline ones) land in the right lists
 * instantly: a task completed disappears from "Hoy", a new task with today's date shows up there, etc. The server
 * stays the source of truth: every query is refetched once the write lands.
 */

/** Does `t` belong in the list fetched with `q`? (`inboxId` resolves the inbox view.) */
export function matchesQuery(t: Task, q: TaskQuery, today: string, inboxId: string | null): boolean {
  if (q.listId && t.listId !== q.listId) return false;
  if (q.tag && !t.tags.includes(q.tag)) return false;
  if (q.status && t.status !== q.status) return false;
  if (q.dueFrom && (!t.dueDate || t.dueDate < q.dueFrom)) return false;
  if (q.dueTo && (!t.dueDate || t.dueDate > q.dueTo)) return false;
  if (q.q) {
    const fold = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
    if (!fold(`${t.title} ${t.notes ?? ""}`).includes(fold(q.q))) return false;
  }
  switch (q.view) {
    case "inbox":
      return t.status === "open" && !t.dueDate && (inboxId === null || t.listId === inboxId);
    case "today":
      return t.status === "open" && t.dueDate === today;
    case "upcoming":
      return t.status === "open" && !!t.dueDate && t.dueDate > today;
    case "overdue":
      return t.status === "open" && !!t.dueDate && t.dueDate < today;
    case "done":
      return t.status === "done";
    default:
      return true;
  }
}

/** The server's ordering for a view. */
export function compareTasks(view: TaskQuery["view"]) {
  if (view === "done") return (a: Task, b: Task) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  if (view === "today" || view === "upcoming" || view === "overdue")
    return (a: Task, b: Task) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
      b.priority - a.priority ||
      a.sortOrder - b.sortOrder;
  return (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/** Inserts, replaces or drops `t` in a fetched list depending on whether it still matches the query. */
export function putTask(list: Task[], t: Task, q: TaskQuery, today: string, inboxId: string | null): Task[] {
  const rest = list.filter((x) => x.id !== t.id);
  if (!matchesQuery(t, q, today, inboxId)) return rest;
  return [...rest, t].sort(compareTasks(q.view));
}

export const removeTask = (list: Task[], id: string) => list.filter((x) => x.id !== id);

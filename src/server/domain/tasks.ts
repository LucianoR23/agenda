import { and, arrayContains, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, max, ne, type SQL, sql } from "drizzle-orm";
import { one } from "../db/one";
import { changeLog, task, taskList } from "../db/schema";
import { type Ctx, sourceOf } from "../http/context";
import { ApiError, notFound, versionConflict } from "../http/errors";
import { diffFields, recordChange } from "./changes";
import { onTaskCompleted, onTaskReopened } from "./habits";
import { nextOccurrence, normalizeTaskRrule } from "./recurrence";
import { formatInstant, type IsoDate, type LocalTime, toDate, today, toInstant } from "./time";

type TaskRow = typeof task.$inferSelect;
type ListRow = typeof taskList.$inferSelect;

const hhmm = (t: string | null): LocalTime | null => (t ? t.slice(0, 5) : null);

// ---------- serialization ----------

export function taskOut(t: TaskRow, ctx: Pick<Ctx, "tz" | "now">) {
  const dueTime = hhmm(t.dueTime);
  return {
    id: t.id,
    listId: t.listId,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    dueTime,
    dueAt: t.dueDate && dueTime ? formatInstant(toInstant(t.dueDate, dueTime, ctx.tz), ctx.tz) : null,
    overdue: t.status === "open" && !!t.dueDate && t.dueDate < today(ctx.tz, { now: () => ctx.now }),
    rrule: t.rrule,
    seriesId: t.seriesId,
    completedAt: t.completedAt ? formatInstant(t.completedAt, ctx.tz) : null,
    sortOrder: t.sortOrder,
    tags: t.tags,
    source: t.source,
    version: t.version,
    createdAt: formatInstant(t.createdAt, ctx.tz),
    updatedAt: formatInstant(t.updatedAt, ctx.tz),
    updatedBy: t.updatedBy,
  };
}

export type TaskOut = ReturnType<typeof taskOut>;

function listOut(l: ListRow, openCount: number, ctx: Pick<Ctx, "tz">) {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    icon: l.icon,
    sortOrder: l.sortOrder,
    isInbox: l.isInbox,
    openCount,
    version: l.version,
    createdAt: formatInstant(l.createdAt, ctx.tz),
    updatedAt: formatInstant(l.updatedAt, ctx.tz),
    updatedBy: l.updatedBy,
  };
}

const userToday = (ctx: Ctx) => today(ctx.tz, { now: () => ctx.now });

// ---------- lists ----------

export async function inbox(ctx: Ctx): Promise<ListRow> {
  return one(
    await ctx.db
      .select()
      .from(taskList)
      .where(and(eq(taskList.isInbox, true), isNull(taskList.deletedAt))),
    "inbox",
  );
}

async function findList(ctx: Ctx, id: string, lock = false): Promise<ListRow> {
  const q = ctx.db
    .select()
    .from(taskList)
    .where(and(eq(taskList.id, id), isNull(taskList.deletedAt)));
  const [l] = lock ? await q.for("update") : await q;
  if (!l) throw notFound("No encontré esa lista. Usá listTaskLists para ver las listas.");
  return l;
}

// table-qualified on purpose: drizzle renders `${taskList.id}` unqualified in single-table selects, which inside
// this subquery would resolve to task.id
const openCountSql = sql<number>`(SELECT count(*)::int FROM task t WHERE t.list_id = "task_list"."id" AND t.status = 'open' AND t.deleted_at IS NULL)`;

export async function listLists(ctx: Ctx) {
  const rows = await ctx.db
    .select({ list: taskList, openCount: openCountSql })
    .from(taskList)
    .where(isNull(taskList.deletedAt))
    .orderBy(desc(taskList.isInbox), asc(taskList.sortOrder), asc(taskList.createdAt));
  return rows.map((r) => listOut(r.list, r.openCount, ctx));
}

async function listWithCount(ctx: Ctx, id: string) {
  const [r] = await ctx.db.select({ list: taskList, openCount: openCountSql }).from(taskList).where(eq(taskList.id, id));
  if (!r) throw notFound();
  return listOut(r.list, r.openCount, ctx);
}

export async function createList(ctx: Ctx, body: { id?: string; name: string; color?: string; icon?: string }) {
  const [last] = await ctx.db
    .select({ n: max(taskList.sortOrder) })
    .from(taskList)
    .where(isNull(taskList.deletedAt));
  const row = one(
    await ctx.db
      .insert(taskList)
      .values({
        ...(body.id ? { id: body.id } : {}),
        name: body.name,
        color: body.color ?? null,
        icon: body.icon ?? null,
        sortOrder: (last?.n ?? 0) + 1,
        updatedBy: sourceOf(ctx.caller),
      })
      .returning(),
    "list insert",
  );
  await recordChange(ctx, "task_list", row.id, "create");
  return listWithCount(ctx, row.id);
}

export async function updateList(
  ctx: Ctx,
  id: string,
  body: { name?: string; color?: string | null; icon?: string | null; sortOrder?: number; version?: number },
) {
  const l = await findList(ctx, id, true);
  const expected = body.version ?? ctx.ifMatch;
  if (expected != null && expected !== l.version) throw versionConflict(await listWithCount(ctx, id));
  const { version: _v, ...patch } = body;
  await ctx.db
    .update(taskList)
    .set({ ...patch, updatedBy: sourceOf(ctx.caller) })
    .where(eq(taskList.id, id));
  await recordChange(ctx, "task_list", id, "update", { fields: diffFields(l, { ...l, ...patch }) });
  return listWithCount(ctx, id);
}

/** Soft-deletes a list; its tasks move to the Inbox. The Inbox itself can't be deleted. */
export async function deleteList(ctx: Ctx, id: string) {
  const l = await findList(ctx, id, true);
  if (l.isInbox) throw new ApiError(409, "CONFLICT", "La Inbox no se puede borrar.");
  const box = await inbox(ctx);
  const moved = await ctx.db
    .update(task)
    .set({ listId: box.id, updatedBy: sourceOf(ctx.caller) })
    .where(and(eq(task.listId, id), isNull(task.deletedAt)))
    .returning({ id: task.id });
  await ctx.db
    .update(taskList)
    .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(taskList.id, id));
  await recordChange(ctx, "task_list", id, "delete", { after: { movedTasks: moved.length } });
  return { movedToInbox: moved.length };
}

// ---------- tasks ----------

async function findTask(ctx: Ctx, id: string, lock = false): Promise<TaskRow> {
  const q = ctx.db
    .select()
    .from(task)
    .where(and(eq(task.id, id), isNull(task.deletedAt)));
  const [t] = lock ? await q.for("update") : await q;
  if (!t) throw notFound("No encontré la tarea con ese id. Usá searchAgenda para buscarla por título.");
  return t;
}

export async function getTask(ctx: Ctx, id: string) {
  return taskOut(await findTask(ctx, id), ctx);
}

/** Escapes LIKE wildcards in user text. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const searchMatch = (q: string) =>
  sql`f_search(${task.title}, ${task.notes}) LIKE '%' || f_search(${likeEscape(q)}::text) || '%' ESCAPE '\\'`;

export interface TaskQuery {
  view?: "inbox" | "today" | "upcoming" | "overdue" | "done" | "all";
  listId?: string;
  tag?: string;
  status?: "open" | "done" | "cancelled";
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  q?: string;
  limit?: number;
}

export async function listTasks(ctx: Ctx, query: TaskQuery) {
  const day = userToday(ctx);
  const where: SQL[] = [isNull(task.deletedAt)];
  let order: SQL[] = [asc(task.sortOrder), asc(task.createdAt)];
  const byDue = [asc(task.dueDate), sql`${task.dueTime} ASC NULLS LAST`, desc(task.priority), asc(task.sortOrder)];

  switch (query.view) {
    case "inbox": {
      const box = await inbox(ctx);
      where.push(eq(task.listId, box.id), isNull(task.dueDate), eq(task.status, "open"));
      break;
    }
    case "today":
      where.push(eq(task.dueDate, day), eq(task.status, "open"));
      order = byDue;
      break;
    case "upcoming":
      where.push(gt(task.dueDate, day), eq(task.status, "open"));
      order = byDue;
      break;
    case "overdue":
      where.push(lt(task.dueDate, day), eq(task.status, "open"));
      order = byDue;
      break;
    case "done":
      where.push(eq(task.status, "done"));
      order = [desc(task.completedAt)];
      break;
    default:
      break;
  }
  if (query.listId) where.push(eq(task.listId, query.listId));
  if (query.tag) where.push(arrayContains(task.tags, [query.tag]));
  if (query.status) where.push(eq(task.status, query.status));
  if (query.dueFrom) where.push(gte(task.dueDate, query.dueFrom));
  if (query.dueTo) where.push(lte(task.dueDate, query.dueTo));
  if (query.q?.trim()) where.push(searchMatch(query.q.trim()));

  const rows = await ctx.db
    .select()
    .from(task)
    .where(and(...where))
    .orderBy(...order)
    .limit(query.limit ?? 200);
  return rows.map((t) => taskOut(t, ctx));
}

/** Text search for searchAgenda (tasks for now; reminders and events join in phases 5 and 6). */
export async function searchTasks(ctx: Ctx, q: string, includeDone: boolean, limit = 20) {
  const where: SQL[] = [isNull(task.deletedAt), searchMatch(q)];
  if (!includeDone) where.push(ne(task.status, "done"), ne(task.status, "cancelled"));
  const rows = await ctx.db
    .select()
    .from(task)
    .where(and(...where))
    .orderBy(sql`similarity(f_search(${task.title}, ${task.notes}), f_search(${q}::text)) DESC`, desc(task.updatedAt))
    .limit(limit);
  return rows.map((t) => taskOut(t, ctx));
}

/** Validates the date/time/recurrence combination of a task about to be written. */
function schedule(
  ctx: Ctx,
  next: { dueDate: IsoDate | null; dueTime: LocalTime | null; rrule: string | null },
): { dueDate: IsoDate | null; dueTime: string | null; rrule: string | null } {
  if (!next.dueDate) {
    if (next.dueTime || next.rrule)
      throw new ApiError(400, "VALIDATION_ERROR", "Una hora o una repetición necesitan una fecha.", {
        fields: [{ path: "/dueDate", message: "Required with dueTime or rrule" }],
      });
    return { dueDate: null, dueTime: null, rrule: null };
  }
  const rrule = next.rrule ? normalizeTaskRrule(next.rrule, next.dueDate, next.dueTime, ctx.tz) : null;
  return { dueDate: next.dueDate, dueTime: next.dueTime, rrule };
}

async function nextSortOrder(ctx: Ctx, listId: string) {
  const [r] = await ctx.db
    .select({ n: max(task.sortOrder) })
    .from(task)
    .where(and(eq(task.listId, listId), isNull(task.deletedAt)));
  return (r?.n ?? 0) + 1;
}

export interface TaskCreate {
  id?: string;
  title: string;
  notes?: string;
  listId?: string;
  priority?: number;
  dueDate?: IsoDate;
  dueTime?: LocalTime;
  rrule?: string;
  tags?: string[];
}

export async function createTask(ctx: Ctx, body: TaskCreate) {
  const listId = body.listId ? (await findList(ctx, body.listId)).id : (await inbox(ctx)).id;
  const when = schedule(ctx, { dueDate: body.dueDate ?? null, dueTime: body.dueTime ?? null, rrule: body.rrule ?? null });
  const source = sourceOf(ctx.caller);
  const row = one(
    await ctx.db
      .insert(task)
      .values({
        ...(body.id ? { id: body.id } : {}),
        listId,
        title: body.title,
        notes: body.notes ?? null,
        priority: body.priority ?? 0,
        ...when,
        tags: [...new Set(body.tags ?? [])],
        sortOrder: await nextSortOrder(ctx, listId),
        source,
        updatedBy: source,
      })
      .returning(),
    "task insert",
  );
  await recordChange(ctx, "task", row.id, "create");
  return taskOut(row, ctx);
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  listId?: string;
  priority?: number;
  dueDate?: IsoDate | null;
  dueTime?: LocalTime | null;
  rrule?: string | null;
  tags?: string[];
  status?: "open" | "cancelled";
  version?: number;
}

const assertVersion = (ctx: Ctx, t: TaskRow, bodyVersion?: number) => {
  const expected = bodyVersion ?? ctx.ifMatch;
  if (expected != null && expected !== t.version) throw versionConflict(taskOut(t, ctx));
};

export async function updateTask(ctx: Ctx, id: string, body: TaskPatch) {
  const t = await findTask(ctx, id, true);
  assertVersion(ctx, t, body.version);
  if (body.listId && body.listId !== t.listId) await findList(ctx, body.listId);

  const dueDate = body.dueDate !== undefined ? body.dueDate : t.dueDate;
  // clearing the date clears the time and recurrence, but sending a time/rrule without a date is an error
  const when = schedule(ctx, {
    dueDate,
    dueTime: body.dueTime !== undefined ? body.dueTime : dueDate === null ? null : hhmm(t.dueTime),
    rrule: body.rrule !== undefined ? body.rrule : dueDate === null ? null : t.rrule,
  });
  const patch = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.listId !== undefined ? { listId: body.listId } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.tags !== undefined ? { tags: [...new Set(body.tags)] } : {}),
    ...(body.status !== undefined ? { status: body.status, completedAt: null } : {}),
    ...when,
  };
  const row = one(
    await ctx.db
      .update(task)
      .set({ ...patch, updatedBy: sourceOf(ctx.caller) })
      .where(eq(task.id, id))
      .returning(),
    "task update",
  );
  await recordChange(ctx, "task", id, "update", { fields: diffFields(t, row) });
  return taskOut(row, ctx);
}

/** Marks done; a recurring task spawns its next occurrence (same series). Completing a done task changes nothing. */
export async function completeTask(ctx: Ctx, id: string, version?: number) {
  const t = await findTask(ctx, id, true);
  if (t.status === "done") return { task: taskOut(t, ctx), next: null };
  assertVersion(ctx, t, version);
  const source = sourceOf(ctx.caller);
  const seriesId = t.rrule ? (t.seriesId ?? t.id) : t.seriesId;
  const done = one(
    await ctx.db
      .update(task)
      .set({ status: "done", completedAt: toDate(ctx.now), seriesId, updatedBy: source })
      .where(eq(task.id, id))
      .returning(),
    "task complete",
  );
  await recordChange(ctx, "task", id, "update", { fields: { status: { from: t.status, to: "done" } } });
  await onTaskCompleted(ctx, t);

  const next = await spawnNext(ctx, t, seriesId);
  return { task: taskOut(done, ctx), next };
}

/** A recurring task's next occurrence (after completing or dropping this one), or null when the series ended. */
async function spawnNext(ctx: Ctx, t: TaskRow, seriesId: string | null): Promise<TaskOut | null> {
  if (!t.rrule || !t.dueDate) return null;
  const occ = nextOccurrence(t.rrule, t.dueDate, hhmm(t.dueTime), ctx.tz, userToday(ctx));
  if (!occ) return null;
  const source = sourceOf(ctx.caller);
  const row = one(
    await ctx.db
      .insert(task)
      .values({
        listId: t.listId,
        title: t.title,
        notes: t.notes,
        priority: t.priority,
        dueDate: occ.dueDate,
        dueTime: t.dueTime,
        rrule: occ.rrule,
        seriesId,
        tags: t.tags,
        sortOrder: t.sortOrder,
        source,
        updatedBy: source,
      })
      .returning(),
    "next occurrence",
  );
  await recordChange(ctx, "task", row.id, "create", { after: { seriesId, from: t.id } });
  return taskOut(row, ctx);
}

/** "Soltar" in the day review: cancelled; a recurring task moves on to its next occurrence. */
export async function dropTask(ctx: Ctx, id: string) {
  const t = await findTask(ctx, id, true);
  if (t.status !== "open") return;
  const seriesId = t.rrule ? (t.seriesId ?? t.id) : t.seriesId;
  await ctx.db
    .update(task)
    .set({ status: "cancelled", seriesId, updatedBy: sourceOf(ctx.caller) })
    .where(eq(task.id, id));
  await recordChange(ctx, "task", id, "update", { fields: { status: { from: "open", to: "cancelled" } } });
  await spawnNext(ctx, t, seriesId);
}

/** The occurrence that completing `id` spawned (recorded in change_log), if it's still open and untouched. */
async function spawnedBy(ctx: Ctx, id: string, seriesId: string): Promise<string | null> {
  const [log] = await ctx.db
    .select({ entityId: changeLog.entityId })
    .from(changeLog)
    .where(and(eq(changeLog.entity, "task"), eq(changeLog.action, "create"), sql`${changeLog.diff} -> 'after' ->> 'from' = ${id}`))
    .orderBy(desc(changeLog.id))
    .limit(1);
  if (!log) return null;
  const [next] = await ctx.db
    .select({ id: task.id })
    .from(task)
    .where(
      and(eq(task.id, log.entityId), eq(task.seriesId, seriesId), eq(task.status, "open"), eq(task.version, 1), isNull(task.deletedAt)),
    );
  return next?.id ?? null;
}

/**
 * Back to open ("Deshacer"). The occurrence that completing it created is removed again so undo leaves no
 * duplicate: `nextId` when the client knows it, otherwise found through change_log (works for offline undo). An
 * occurrence that was already edited is kept.
 */
export async function reopenTask(ctx: Ctx, id: string, nextId?: string) {
  const t = await findTask(ctx, id, true);
  if (t.status !== "open") {
    await ctx.db
      .update(task)
      .set({ status: "open", completedAt: null, updatedBy: sourceOf(ctx.caller) })
      .where(eq(task.id, id));
    await recordChange(ctx, "task", id, "update", { fields: { status: { from: t.status, to: "open" } } });
    if (t.status === "done") await onTaskReopened(ctx, t);
  }
  const spawned = t.seriesId ? (nextId ?? (await spawnedBy(ctx, id, t.seriesId))) : null;
  if (spawned && t.seriesId) {
    const removed = await ctx.db
      .update(task)
      .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
      .where(and(eq(task.id, spawned), eq(task.seriesId, t.seriesId), eq(task.status, "open"), isNull(task.deletedAt)))
      .returning({ id: task.id });
    if (removed[0]) await recordChange(ctx, "task", spawned, "delete", { after: { undoOf: id } });
  }
  return getTask(ctx, id);
}

/** Soft delete (offline clients need the tombstone; purged after 30 days). */
export async function deleteTask(ctx: Ctx, id: string) {
  await findTask(ctx, id, true);
  await ctx.db
    .update(task)
    .set({ deletedAt: toDate(ctx.now), updatedBy: sourceOf(ctx.caller) })
    .where(eq(task.id, id));
  await recordChange(ctx, "task", id, "delete");
}

/** Sets sort_order from the given order (tasks of one list, e.g. after a drag in the Inbox). */
export async function reorderTasks(ctx: Ctx, ids: string[]) {
  const rows = await ctx.db
    .select({ id: task.id, listId: task.listId })
    .from(task)
    .where(and(inArray(task.id, ids), isNull(task.deletedAt)));
  if (rows.length !== new Set(ids).size) throw notFound("Alguna de esas tareas no existe.");
  if (new Set(rows.map((r) => r.listId)).size > 1)
    throw new ApiError(400, "VALIDATION_ERROR", "Solo se pueden reordenar tareas de una misma lista.", {
      fields: [{ path: "/ids", message: "Tasks from more than one list" }],
    });
  for (const [i, taskId] of ids.entries())
    await ctx.db
      .update(task)
      .set({ sortOrder: i + 1, updatedBy: sourceOf(ctx.caller) })
      .where(eq(task.id, taskId));
  return listTasks(ctx, { listId: rows[0]?.listId ?? "", status: "open" });
}

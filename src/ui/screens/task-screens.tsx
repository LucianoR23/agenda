"use client";

import { closestCenter, DndContext, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";
import { useDirect, useEvents, useReminders, useTaskLists, useTasks } from "@/client/queries";
import { isoInZone } from "@/client/reminder-actions";
import { useTaskActions } from "@/client/task-actions";
import type { Task, TaskList, TaskQuery } from "@/client/types";
import { Button, Fab, FilterChip, Segmented, TextField } from "../components/controls";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { EmptyState, TimelineSkeleton } from "../components/surfaces";
import { SwipeRow, TaskRow } from "../components/task-row";
import { dayLabel, todayLocal, userTimeZone } from "../time";
import { useEventUi } from "./calendar-screens";
import { RemindersScreen, useReminderUi } from "./reminder-screens";
import { QuickAddSheet, RescheduleSheet, TaskEditor } from "./task-sheets";

type Sheet = { kind: "add" } | { kind: "edit"; task: Task } | { kind: "move"; task: Task } | null;

/** Sheets (quick add, editor, reschedule) and the swipe/check actions shared by every task screen. */
function useTaskUi(addMode: "task" | "reminder" | "event" = "task") {
  const lists = useTaskLists().data?.lists ?? [];
  const actions = useTaskActions();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const listName = (id: string) => lists.find((l) => l.id === id && !l.isInbox)?.name;

  const toggle = (t: Task) => {
    if (t.status === "done") {
      actions.reopen(t);
      return;
    }
    const done = actions.complete(t);
    toast({
      icon: "check_circle",
      message: t.rrule
        ? `"${t.title}" hecha · vuelve ${t.rrule.includes("DAILY") ? "mañana" : "en la próxima fecha"}`
        : `"${t.title}" hecha`,
      action: "Deshacer",
      onAction: () => actions.reopen(done),
    });
  };

  const row = (t: Task, opts: { showDate?: boolean; showList?: boolean; trailing?: ReactNode } = {}) => (
    <SwipeRow
      key={t.id}
      disabled={t.status !== "open"}
      right={{ icon: "check_circle", label: "Hecha", tone: "success" }}
      left={{ icon: "event", label: "Mover", tone: "neutral" }}
      onRight={() => toggle(t)}
      onLeft={() => setSheet({ kind: "move", task: t })}
    >
      <TaskRow
        task={t}
        today={todayLocal()}
        listName={opts.showList === false ? undefined : listName(t.listId)}
        showDate={opts.showDate ?? true}
        onToggle={() => toggle(t)}
        onOpen={() => setSheet({ kind: "edit", task: t })}
        trailing={opts.trailing}
      />
    </SwipeRow>
  );

  const sheets = (
    <>
      <BottomSheet open={sheet?.kind === "add"} onClose={() => setSheet(null)} label="Nueva tarea">
        {sheet?.kind === "add" && <QuickAddSheet lists={lists} initialMode={addMode} onDone={() => setSheet(null)} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "edit"} onClose={() => setSheet(null)} label="Editar tarea">
        {sheet?.kind === "edit" && <TaskEditor task={sheet.task} lists={lists} onDone={() => setSheet(null)} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "move"} onClose={() => setSheet(null)} label="Mover tarea">
        {sheet?.kind === "move" && <RescheduleSheet task={sheet.task} onDone={() => setSheet(null)} />}
      </BottomSheet>
    </>
  );

  const fab = (
    <div className="fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 md:bottom-8">
      <Fab
        label={addMode === "reminder" ? "Nuevo recordatorio" : addMode === "event" ? "Nuevo evento" : "Nueva tarea"}
        onClick={() => setSheet({ kind: "add" })}
      />
    </div>
  );

  return { lists, row, sheets, fab, openAdd: () => setSheet({ kind: "add" }) };
}

function Loading() {
  return <TimelineSkeleton />;
}

// ---------- Hoy ----------

/** Hoy: overdue first, then today's tasks with a time (in order), then today's without. */
export function TodayScreen() {
  const today = todayLocal();
  const ui = useTaskUi();
  const reminderUi = useReminderUi();
  const eventUi = useEventUi();
  const events = useEvents(today, today).data?.events ?? [];
  const dayStart = Temporal.PlainDate.from(today).toZonedDateTime({ timeZone: userTimeZone() });
  const reminders = (
    useReminders({
      view: "all",
      from: isoInZone(dayStart.toInstant()),
      to: isoInZone(dayStart.add({ days: 1 }).toInstant().subtract({ milliseconds: 1 })),
    }).data?.reminders ?? []
  ).filter((r) => r.status !== "cancelled");
  const todays = useTasks({ view: "today" });
  const overdue = useTasks({ view: "overdue" });
  const all = todays.data?.tasks ?? [];
  const timed = all.filter((t) => t.dueTime);
  const untimed = all.filter((t) => !t.dueTime);
  const late = overdue.data?.tasks ?? [];
  const loading = todays.isPending && overdue.isPending;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Hoy" subtitle={dayLabel(today, today).replace("Hoy · ", "")} />
      {loading ? (
        <Loading />
      ) : late.length + all.length + reminders.length + events.length === 0 ? (
        <EmptyState
          icon="check_circle"
          title="Nada para hoy"
          body="Agregá una tarea con el botón + o pedíselo a Sunday."
          actions={<Button onClick={ui.openAdd}>Agregar tarea</Button>}
        />
      ) : (
        <>
          {events.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Agenda de hoy">
              <SectionLabel>Agenda</SectionLabel>
              {events.map(eventUi.row)}
            </section>
          )}
          {late.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Vencidas">
              <SectionLabel>Vencidas · {late.length}</SectionLabel>
              {late.map((t) => ui.row(t))}
            </section>
          )}
          {timed.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Con hora">
              <SectionLabel>Con hora</SectionLabel>
              {timed.map((t) => ui.row(t, { showDate: false }))}
            </section>
          )}
          {untimed.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Para hoy">
              <SectionLabel>Para hoy</SectionLabel>
              {untimed.map((t) => ui.row(t, { showDate: false }))}
            </section>
          )}
          {reminders.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Recordatorios de hoy">
              <SectionLabel>Recordatorios</SectionLabel>
              {reminders.map((r) => reminderUi.row(r, { showStatus: r.status !== "scheduled" }))}
            </section>
          )}
        </>
      )}
      {ui.fab}
      {ui.sheets}
      {reminderUi.sheets}
      {eventUi.sheets}
    </div>
  );
}

// ---------- Inbox ----------

function SortableTask({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label="Arrastrar para reordenar"
      className="-mr-1.5 flex size-11 shrink-0 touch-none items-center justify-center text-muted"
    >
      <Icon name="drag_indicator" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={isDragging ? "opacity-90 shadow-lg" : undefined}
    >
      {children(handle)}
    </div>
  );
}

/** Inbox: undated tasks to sort out. Drag the handle to reorder; tap to give it a date, list or priority. */
export function InboxScreen() {
  const ui = useTaskUi();
  const actions = useTaskActions();
  const q = useTasks({ view: "inbox" });
  const tasks = q.data?.tasks ?? [];
  const [order, setOrder] = useState<string[] | null>(null);
  const shown = order ? order.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t) : tasks;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = shown.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    actions.reorder(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Inbox" subtitle={tasks.length ? `${tasks.length} sin fecha` : undefined} />
      {q.isPending ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="Inbox vacía"
          body="Lo que anotes sin fecha cae acá para ordenarlo después."
          actions={<Button onClick={ui.openAdd}>Anotar algo</Button>}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {shown.map((t) => (
                <SortableTask key={t.id} id={t.id}>
                  {(handle) => ui.row(t, { showList: false, trailing: handle })}
                </SortableTask>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {ui.fab}
      {ui.sheets}
    </div>
  );
}

// ---------- Tareas ----------

type Filter = "today" | "upcoming" | "overdue" | "done";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "today", label: "Hoy" },
  { value: "upcoming", label: "Próximas" },
  { value: "overdue", label: "Vencidas" },
  { value: "done", label: "Hechas" },
];

/** Tareas: filters, lists, tags and search over everything. */
export function TasksScreen() {
  const ui = useTaskUi();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [listId, setListId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [listSheet, setListSheet] = useState<TaskList | "new" | null>(null);
  const query: TaskQuery = search.trim()
    ? { view: "all", status: "open", q: search.trim(), ...(listId ? { listId } : {}) }
    : { view: filter, ...(listId ? { listId } : {}) };
  const q = useTasks(query);
  const tasks = q.data?.tasks ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Tareas" />
      <TextField label="Buscar tareas" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
      {!search.trim() && <Segmented value={filter} onChange={setFilter} options={FILTERS} />}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip selected={listId === null} onClick={() => setListId(null)}>
          Todas
        </FilterChip>
        {ui.lists.map((l) => (
          <FilterChip
            key={l.id}
            selected={listId === l.id}
            onClick={() => setListId(listId === l.id ? null : l.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!l.isInbox) setListSheet(l);
            }}
          >
            {l.name}
            {l.openCount > 0 && <span className="font-mono text-caption opacity-70">{l.openCount}</span>}
          </FilterChip>
        ))}
        <FilterChip onClick={() => setListSheet("new")} aria-label="Nueva lista">
          <Icon name="add" size={16} /> Lista
        </FilterChip>
      </div>
      {listId && !ui.lists.find((l) => l.id === listId)?.isInbox && (
        <Button
          variant="ghost"
          icon="edit"
          className="self-start px-0"
          onClick={() => setListSheet(ui.lists.find((l) => l.id === listId) ?? null)}
        >
          Editar lista
        </Button>
      )}

      {q.isPending ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="checklist"
          title={search ? "Sin resultados" : "Nada por acá"}
          body={search ? "Probá con otra palabra." : "Cambiá el filtro o agregá una tarea."}
        />
      ) : (
        <div className="flex flex-col gap-2">{tasks.map((t) => ui.row(t, { showList: listId === null }))}</div>
      )}

      <BottomSheet open={listSheet !== null} onClose={() => setListSheet(null)} label="Lista">
        {listSheet !== null && (
          <ListSheet
            list={listSheet === "new" ? null : listSheet}
            onDone={(deleted) => {
              if (deleted) setListId(null);
              setListSheet(null);
            }}
          />
        )}
      </BottomSheet>
      {ui.fab}
      {ui.sheets}
    </div>
  );
}

/** Create, rename or delete a list (its tasks go to the Inbox). Online-only, like other settings. */
function ListSheet({ list, onDone }: { list: TaskList | null; onDone: (deleted?: boolean) => void }) {
  const direct = useDirect();
  const toast = useToast();
  const [name, setName] = useState(list?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const refresh = [["lists"], ["tasks"]];
  const fail = (e: unknown) => setError((e as Error).message);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">{list ? "Editar lista" : "Nueva lista"}</h2>
      <TextField label="Nombre" hideLabel={false} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button
        size="lg"
        disabled={!name.trim() || name.trim() === list?.name}
        onClick={() =>
          (list
            ? direct("PATCH", `/api/lists/${list.id}`, { name: name.trim(), version: list.version }, refresh)
            : direct("POST", "/api/lists", { name: name.trim() }, refresh)
          ).then(() => onDone(), fail)
        }
      >
        {list ? "Guardar" : "Crear"}
      </Button>
      {list && (
        <Button
          variant="danger"
          icon="delete"
          onClick={() =>
            direct<{ movedToInbox: number }>("DELETE", `/api/lists/${list.id}`, undefined, refresh).then((r) => {
              toast({ icon: "delete", message: r.movedToInbox ? `Lista borrada · ${r.movedToInbox} tareas a Inbox` : "Lista borrada" });
              onDone(true);
            }, fail)
          }
        >
          Borrar lista
        </Button>
      )}
    </div>
  );
}

// ---------- Recordatorios ----------

/** Recordatorios, with the "+" opening in reminder mode. */
export function RemindersTab() {
  const ui = useTaskUi("reminder");
  return <RemindersScreen fab={ui.fab} quickAdd={ui.sheets} />;
}

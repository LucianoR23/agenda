"use client";

import { useState } from "react";
import { useEventActions } from "@/client/event-actions";
import { localToIso, useReminderActions } from "@/client/reminder-actions";
import { useTaskActions } from "@/client/task-actions";
import type { Task, TaskList } from "@/client/types";
import { Button, FilterChip, Segmented, TextArea, TextField } from "../components/controls";
import { DatePicker, TimePicker } from "../components/date-picker";
import { Icon } from "../components/icon";
import { useToast } from "../components/overlay";
import { RowGroup, SheetRow } from "../components/surfaces";
import { parseQuickAdd } from "../quick-add";
import { dayLabel, todayLocal, whenLabel } from "../time";

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DOW_NAME = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

type RepeatPreset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";

/** RRULE ↔ the presets the editor offers (anything else is shown as "personalizada" and kept as is). */
export function presetOf(rrule: string | null, dueDate: string | null): RepeatPreset {
  if (!rrule) return "none";
  if (rrule === "FREQ=DAILY") return "daily";
  if (rrule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  if (dueDate && rrule === `FREQ=WEEKLY;BYDAY=${BYDAY[Temporal.PlainDate.from(dueDate).dayOfWeek - 1]}`) return "weekly";
  if (rrule === "FREQ=WEEKLY") return "weekly";
  if (rrule === "FREQ=MONTHLY") return "monthly";
  if (rrule === "FREQ=YEARLY") return "yearly";
  return "custom";
}

function rruleOf(preset: RepeatPreset, dueDate: string | null, current: string | null): string | null {
  switch (preset) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return dueDate ? `FREQ=WEEKLY;BYDAY=${BYDAY[Temporal.PlainDate.from(dueDate).dayOfWeek - 1]}` : "FREQ=WEEKLY";
    case "monthly":
      return "FREQ=MONTHLY";
    case "yearly":
      return "FREQ=YEARLY";
    case "custom":
      return current;
    default:
      return null;
  }
}

/** "todos los lunes", "todos los días"… for chips and summaries. */
export function repeatLabel(rrule: string | null, dueDate: string | null): string | null {
  const p = presetOf(rrule, dueDate);
  if (p === "none") return null;
  if (p === "daily") return "Todos los días";
  if (p === "weekdays") return "Días de semana";
  if (p === "weekly") {
    const by = rrule?.match(/BYDAY=([A-Z,]+)/)?.[1];
    const names = by?.split(",").map((d) => DOW_NAME[BYDAY.indexOf(d)]);
    return names?.length ? `Todos los ${names.join(" y ")}` : "Cada semana";
  }
  if (p === "monthly") return "Cada mes";
  if (p === "yearly") return "Cada año";
  return "Personalizada";
}

const PRIORITIES = [
  { value: "0", label: "Ninguna" },
  { value: "1", label: "Baja" },
  { value: "2", label: "Media" },
  { value: "3", label: "Alta" },
];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// ---------- quick add ----------

/** "+": type naturally, see what was understood as chips, tap a chip to drop it, save. */
export function QuickAddSheet({
  lists,
  onDone,
  initialMode = "task",
}: {
  lists: TaskList[];
  onDone: () => void;
  initialMode?: "task" | "reminder" | "event";
}) {
  const actions = useTaskActions();
  const reminders = useReminderActions();
  const events = useEventActions();
  const toast = useToast();
  const [mode, setMode] = useState<"task" | "reminder" | "event">(initialMode);
  const [text, setText] = useState("");
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const today = todayLocal();
  const draft = parseQuickAdd(text, today);
  const list = draft.listName ? lists.find((l) => fold(l.name) === fold(draft.listName ?? "")) : undefined;
  const keep = (k: string) => !dropped.has(k);

  const chips: Array<{ key: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; warn?: boolean }> = [];
  if (draft.dueDate) chips.push({ key: "date", icon: "event", label: dayLabel(draft.dueDate, today) });
  if (draft.dueTime) chips.push({ key: "time", icon: "schedule", label: draft.dueTime });
  if (draft.rrule) chips.push({ key: "repeat", icon: "repeat", label: repeatLabel(draft.rrule, draft.dueDate) ?? "Se repite" });
  const asReminder = mode === "reminder";
  const asEvent = mode === "event";
  if (draft.listName && mode === "task")
    chips.push(
      list
        ? { key: "list", icon: "checklist", label: list.name }
        : { key: "list", icon: "info", label: `No hay lista "${draft.listName}"`, warn: true },
    );
  if (draft.priority && !asEvent)
    chips.push({
      key: "priority",
      icon: "flag",
      label: asReminder ? (draft.priority === 3 ? "Urgente" : "Normal") : (PRIORITIES[draft.priority]?.label ?? ""),
    });
  if (mode === "task") for (const t of draft.tags) chips.push({ key: `tag:${t}`, icon: "label", label: `+${t}` });
  // a reminder needs a moment: a date (default today) and a time
  const reminderTime = keep("time") ? draft.dueTime : null;
  const missingTime = asReminder && !!draft.title && !reminderTime;

  const save = () => {
    if (!draft.title) return;
    if (asEvent) {
      // with a time: one hour from it; without: all day
      const date = (keep("date") ? draft.dueDate : null) ?? today;
      const time = keep("time") ? draft.dueTime : null;
      const end = time ? Temporal.PlainTime.from(time).add({ hours: 1 }) : null;
      events.create({
        title: draft.title,
        allDay: !time,
        ...(time
          ? {
              startsAt: localToIso(date, time),
              endsAt: end && end.toString() > time ? localToIso(date, end.toString({ smallestUnit: "minute" })) : null,
            }
          : { startDate: date }),
        rrule: keep("repeat") ? draft.rrule : null,
      });
      toast({ icon: "event", message: `Evento para ${dayLabel(date, today).toLowerCase()}${time ? ` a las ${time}` : ""}` });
      setText("");
      setDropped(new Set());
      onDone();
      return;
    }
    if (asReminder) {
      if (!reminderTime) return;
      const date = (keep("date") ? draft.dueDate : null) ?? today;
      const created = reminders.create({
        title: draft.title,
        fireAt: localToIso(date, reminderTime),
        rrule: keep("repeat") ? draft.rrule : null,
        urgent: draft.priority === 3 && keep("priority"),
      });
      toast({ icon: "notifications", message: `Te aviso ${whenLabel(created.fireAt).toLowerCase()}` });
      setText("");
      setDropped(new Set());
      onDone();
      return;
    }
    const dueDate = keep("date") ? draft.dueDate : null;
    const created = actions.create({
      title: draft.title,
      dueDate,
      dueTime: dueDate && keep("time") ? draft.dueTime : null,
      rrule: dueDate && keep("repeat") ? draft.rrule : null,
      ...(list && keep("list") ? { listId: list.id } : {}),
      ...(draft.priority && keep("priority") ? { priority: draft.priority } : {}),
      tags: draft.tags.filter((t) => keep(`tag:${t}`)),
    });
    toast({
      icon: "check_circle",
      message: created.dueDate ? `Agregada para ${dayLabel(created.dueDate, today).toLowerCase()}` : "Agregada a Inbox",
    });
    setText("");
    setDropped(new Set());
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "task", label: "Tarea" },
          { value: "reminder", label: "Recordatorio" },
          { value: "event", label: "Evento" },
        ]}
      />
      <TextField
        label={asEvent ? "Evento" : asReminder ? "Recordatorio" : "Tarea"}
        autoFocus
        placeholder={asEvent ? "jueves 10 dentista" : "mañana 9 llamar al contador #trabajo"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDropped(new Set());
        }}
        enterKeyHint="done"
      />
      {chips.length > 0 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Lo que entendí (tocá para quitar)</legend>
          {chips.map((c) => (
            <FilterChip
              key={c.key}
              selected={keep(c.key) && !c.warn}
              aria-pressed={keep(c.key)}
              onClick={() => setDropped((d) => new Set(d.has(c.key) ? [...d].filter((x) => x !== c.key) : [...d, c.key]))}
            >
              <Icon name={c.icon} size={16} /> {c.label}
            </FilterChip>
          ))}
        </fieldset>
      )}
      {missingTime ? (
        <p className="text-caption text-danger">Falta la hora: por ejemplo “a las 9” o “18:30”.</p>
      ) : (
        <p className="text-caption text-muted">
          {asEvent
            ? "Fecha y hora en palabras; sin hora es de todo el día."
            : asReminder
              ? "Fecha y hora en palabras; !alta = urgente."
              : "Fecha y hora en palabras, #lista, !alta / !media / !baja, +etiqueta."}
        </p>
      )}
      <Button size="lg" type="submit" disabled={!draft.title || missingTime}>
        Agregar
      </Button>
    </form>
  );
}

// ---------- reschedule ----------

/** Swipe left: pick a new date fast (mañana, próximo lunes…) or remove it. Keeps the time. */
export function RescheduleSheet({ task, onDone }: { task: Task; onDone: () => void }) {
  const actions = useTaskActions();
  const toast = useToast();
  const today = todayLocal();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Mover "{task.title}"</h2>
      <DatePicker
        value={task.dueDate}
        today={today}
        onChange={(dueDate) => {
          actions.update(task, dueDate ? { dueDate } : { dueDate: null });
          toast({ icon: "event", message: dueDate ? `Movida a ${dayLabel(dueDate, today).toLowerCase()}` : "Sin fecha: va a Inbox" });
          onDone();
        }}
      />
    </div>
  );
}

// ---------- editor ----------

/** Full editor for one task. Saves only what changed (one optimistic PATCH). */
export function TaskEditor({ task, lists, onDone }: { task: Task; lists: TaskList[]; onDone: () => void }) {
  const actions = useTaskActions();
  const toast = useToast();
  const today = todayLocal();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [dueTime, setDueTime] = useState(task.dueTime);
  const [repeat, setRepeat] = useState<RepeatPreset>(presetOf(task.rrule, task.dueDate));
  const [priority, setPriority] = useState(String(task.priority));
  const [listId, setListId] = useState(task.listId);
  const [tags, setTags] = useState(task.tags);
  const [tagInput, setTagInput] = useState("");
  const [open, setOpen] = useState<"date" | "time" | null>(null);

  const rrule = dueDate ? rruleOf(repeat, dueDate, task.rrule) : null;
  const patch = {
    ...(title.trim() !== task.title ? { title: title.trim() } : {}),
    ...((notes.trim() || null) !== task.notes ? { notes: notes.trim() || null } : {}),
    ...(dueDate !== task.dueDate ? { dueDate } : {}),
    ...(dueDate && dueTime !== task.dueTime ? { dueTime } : {}),
    ...(rrule !== task.rrule ? { rrule } : {}),
    ...(Number(priority) !== task.priority ? { priority: Number(priority) } : {}),
    ...(listId !== task.listId ? { listId } : {}),
    ...(JSON.stringify(tags) !== JSON.stringify(task.tags) ? { tags } : {}),
  };
  const dirty = Object.keys(patch).length > 0;

  const addTag = () => {
    const t = tagInput.trim().replace(/^[+#]/, "").toLowerCase();
    if (t && !/\s/.test(t) && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Título" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label="Notas" placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <RowGroup>
        <SheetRow
          icon="event"
          label={dueDate ? dayLabel(dueDate, today) : "Sin fecha"}
          chevron
          onClick={() => setOpen(open === "date" ? null : "date")}
        />
        {dueDate && (
          <SheetRow icon="schedule" label={dueTime ?? "Sin hora"} chevron onClick={() => setOpen(open === "time" ? null : "time")} />
        )}
      </RowGroup>
      {open === "date" && (
        <DatePicker
          value={dueDate}
          today={today}
          onChange={(d) => {
            setDueDate(d);
            if (!d) {
              setDueTime(null);
              setRepeat("none");
            }
            setOpen(null);
          }}
        />
      )}
      {open === "time" && dueDate && <TimePicker value={dueTime} onChange={setDueTime} />}

      {dueDate && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Repetir</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["none", "Nunca"],
                ["daily", "Todos los días"],
                ["weekdays", "Días de semana"],
                ["weekly", `Cada ${DOW_NAME[Temporal.PlainDate.from(dueDate).dayOfWeek - 1]}`],
                ["monthly", "Cada mes"],
                ["yearly", "Cada año"],
                ...(task.rrule && presetOf(task.rrule, task.dueDate) === "custom" ? [["custom", "Personalizada"]] : []),
              ] as Array<[RepeatPreset, string]>
            ).map(([value, label]) => (
              <FilterChip key={value} selected={repeat === value} onClick={() => setRepeat(value)}>
                {label}
              </FilterChip>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">Prioridad</span>
        <Segmented background="bg-surface" value={priority} onChange={setPriority} options={PRIORITIES} />
      </div>

      {lists.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Lista</span>
          <div className="flex flex-wrap gap-2">
            {lists.map((l) => (
              <FilterChip key={l.id} selected={listId === l.id} onClick={() => setListId(l.id)}>
                {l.name}
              </FilterChip>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">Etiquetas</span>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <FilterChip key={t} selected onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Quitar etiqueta ${t}`}>
              +{t} <Icon name="close" size={14} />
            </FilterChip>
          ))}
        </div>
        <TextField
          label="Agregar etiqueta"
          placeholder="Agregar etiqueta"
          value={tagInput}
          maxLength={40}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
        />
      </div>

      <Button
        size="lg"
        disabled={!dirty || !title.trim()}
        onClick={() => {
          actions.update(task, patch);
          onDone();
        }}
      >
        Guardar
      </Button>
      <div className="flex gap-2">
        {task.status !== "done" && (
          <Button
            variant="secondary"
            icon="check"
            className="flex-1"
            onClick={() => {
              actions.complete(task);
              onDone();
            }}
          >
            Completar
          </Button>
        )}
        {/* a completed task is history: it can be reopened, not deleted */}
        {task.status !== "done" && (
          <Button
            variant="danger"
            icon="delete"
            className="flex-1"
            onClick={() => {
              actions.remove(task);
              toast({ icon: "delete", message: `"${task.title}" borrada` });
              onDone();
            }}
          >
            Borrar
          </Button>
        )}
      </div>
    </div>
  );
}

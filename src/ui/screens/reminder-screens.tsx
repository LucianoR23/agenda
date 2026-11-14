"use client";

import { type ReactNode, useState } from "react";
import { useReminders } from "@/client/queries";
import { localToIso, useReminderActions } from "@/client/reminder-actions";
import type { Reminder } from "@/client/types";
import { Button, FilterChip, Segmented, StatusChip, TextArea, TextField, Toggle } from "../components/controls";
import { DatePicker, TimePicker } from "../components/date-picker";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle } from "../components/page";
import { EmptyState, RowGroup, SheetRow, TimelineSkeleton } from "../components/surfaces";
import { SwipeRow } from "../components/task-row";
import { dayLabel, todayLocal, userTimeZone, whenLabel } from "../time";
import { repeatLabel } from "./task-sheets";

const local = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(userTimeZone());

const STATUS: Record<
  Reminder["status"],
  { label: string; icon: Parameters<typeof Icon>[0]["name"]; tone: "neutral" | "success" | "muted" | "danger" }
> = {
  scheduled: { label: "Programado", icon: "schedule", tone: "neutral" },
  sent: { label: "Enviado", icon: "notifications", tone: "neutral" },
  done: { label: "Hecho", icon: "check_circle", tone: "success" },
  missed: { label: "Perdido", icon: "event_busy", tone: "danger" },
  cancelled: { label: "Cancelado", icon: "do_not_disturb_on", tone: "muted" },
};

export function ReminderRow({ reminder: r, onOpen, showStatus }: { reminder: Reminder; onOpen: () => void; showStatus?: boolean }) {
  const s = STATUS[r.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg bg-surface px-3.5 py-2.5 text-left"
    >
      <Icon
        name={r.urgent ? "flag" : "notifications"}
        className={r.urgent ? "text-danger" : "text-accent"}
        label={r.urgent ? "Urgente" : undefined}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] text-text">{r.title}</span>
        <span className="flex items-center gap-2 text-caption text-muted">
          {whenLabel(r.fireAt)}
          {r.rrule && <Icon name="repeat" size={14} label="Se repite" />}
          {r.snoozedFrom && <span>pospuesto</span>}
        </span>
      </span>
      {showStatus && (
        <StatusChip tone={s.tone} icon={s.icon}>
          {s.label}
        </StatusChip>
      )}
    </button>
  );
}

type Sheet = { kind: "edit"; reminder: Reminder } | { kind: "snooze"; reminder: Reminder } | null;

/** Swipe right = Listo, left = Posponer; tap = editor. Shared by Recordatorios and Hoy. */
export function useReminderUi() {
  const actions = useReminderActions();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);

  const row = (r: Reminder, opts: { showStatus?: boolean } = {}) => (
    <SwipeRow
      key={r.id}
      disabled={r.status === "done" || r.status === "cancelled"}
      right={{ icon: "check_circle", label: "Listo", tone: "success" }}
      left={{ icon: "schedule", label: "Posponer", tone: "neutral" }}
      onRight={() => {
        actions.done(r);
        toast({ icon: "check_circle", message: `"${r.title}" listo` });
      }}
      onLeft={() => setSheet({ kind: "snooze", reminder: r })}
    >
      <ReminderRow reminder={r} onOpen={() => setSheet({ kind: "edit", reminder: r })} showStatus={opts.showStatus ?? false} />
    </SwipeRow>
  );

  const sheets = (
    <>
      <BottomSheet open={sheet?.kind === "edit"} onClose={() => setSheet(null)} label="Recordatorio">
        {sheet?.kind === "edit" && <ReminderEditor reminder={sheet.reminder} onDone={() => setSheet(null)} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "snooze"} onClose={() => setSheet(null)} label="Posponer">
        {sheet?.kind === "snooze" && <SnoozeSheet reminder={sheet.reminder} onDone={() => setSheet(null)} />}
      </BottomSheet>
    </>
  );
  return { row, sheets };
}

/** Posponer: 10 min, 1 h, mañana 9:00 or a date + time. */
function SnoozeSheet({ reminder: r, onDone }: { reminder: Reminder; onDone: () => void }) {
  const actions = useReminderActions();
  const toast = useToast();
  const [custom, setCustom] = useState(false);
  const today = todayLocal();
  const [date, setDate] = useState<string>(today);
  const [time, setTime] = useState<string | null>(null);
  const tomorrow9 = localToIso(Temporal.PlainDate.from(today).add({ days: 1 }).toString(), "09:00");
  const apply = (opts: { minutes: number } | { until: string }) => {
    const next = actions.snooze(r, opts);
    toast({ icon: "schedule", message: `Pospuesto a ${whenLabel(next.fireAt).toLowerCase()}` });
    onDone();
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Posponer "{r.title}"</h2>
      <RowGroup>
        <SheetRow icon="schedule" label="10 minutos" onClick={() => apply({ minutes: 10 })} />
        <SheetRow icon="schedule" label="1 hora" onClick={() => apply({ minutes: 60 })} />
        <SheetRow icon="event" label="Mañana a las 9:00" onClick={() => apply({ until: tomorrow9 })} />
        <SheetRow icon="calendar_month" label="Elegir fecha y hora" chevron onClick={() => setCustom(!custom)} />
      </RowGroup>
      {custom && (
        <>
          <DatePicker value={date} today={today} allowNone={false} onChange={(d) => d && setDate(d)} />
          <TimePicker value={time} onChange={setTime} />
          <Button size="lg" disabled={!time} onClick={() => time && apply({ until: localToIso(date, time) })}>
            Posponer
          </Button>
        </>
      )}
    </div>
  );
}

const REPEATS: Array<[string | null, string]> = [
  [null, "Nunca"],
  ["FREQ=DAILY", "Todos los días"],
  ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Días de semana"],
  ["FREQ=WEEKLY", "Cada semana"],
  ["FREQ=MONTHLY", "Cada mes"],
];

/** Title, note, date, time, repeat, urgent; Listo / Cancelar. */
function ReminderEditor({ reminder: r, onDone }: { reminder: Reminder; onDone: () => void }) {
  const actions = useReminderActions();
  const toast = useToast();
  const today = todayLocal();
  const z = local(r.fireAt);
  const [title, setTitle] = useState(r.title);
  const [body, setBody] = useState(r.body ?? "");
  const [date, setDate] = useState(z.toPlainDate().toString());
  const [time, setTime] = useState<string | null>(z.toPlainTime().toString({ smallestUnit: "minute" }));
  const [rrule, setRrule] = useState(r.rrule);
  const [urgent, setUrgent] = useState(r.urgent);
  const [open, setOpen] = useState<"date" | "time" | null>(null);
  const fireAt = time ? localToIso(date, time) : r.fireAt;
  const moved = Temporal.Instant.compare(Temporal.Instant.from(fireAt), Temporal.Instant.from(r.fireAt)) !== 0;
  const patch = {
    ...(title.trim() !== r.title ? { title: title.trim() } : {}),
    ...((body.trim() || null) !== r.body ? { body: body.trim() || null } : {}),
    ...(moved ? { fireAt } : {}),
    ...(rrule !== r.rrule ? { rrule } : {}),
    ...(urgent !== r.urgent ? { urgent } : {}),
  };
  const dirty = Object.keys(patch).length > 0;
  const custom = r.rrule && !REPEATS.some(([v]) => v === r.rrule);

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Título" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
      <TextArea
        label="Nota"
        placeholder="Nota (aparece en la notificación)"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <RowGroup>
        <SheetRow icon="event" label={dayLabel(date, today)} chevron onClick={() => setOpen(open === "date" ? null : "date")} />
        <SheetRow icon="schedule" label={time ?? "Elegí la hora"} chevron onClick={() => setOpen(open === "time" ? null : "time")} />
        <SheetRow
          icon="flag"
          label="Urgente (ignora las horas de silencio)"
          trailing={<Toggle checked={urgent} onChange={setUrgent} label="Urgente" />}
        />
      </RowGroup>
      {open === "date" && (
        <DatePicker
          value={date}
          today={today}
          allowNone={false}
          onChange={(d) => {
            if (d) setDate(d);
            setOpen(null);
          }}
        />
      )}
      {open === "time" && <TimePicker value={time} onChange={setTime} />}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">Repetir</span>
        <div className="flex flex-wrap gap-2">
          {REPEATS.map(([value, label]) => (
            <FilterChip key={label} selected={rrule === value} onClick={() => setRrule(value)}>
              {label}
            </FilterChip>
          ))}
          {custom && (
            <FilterChip selected={rrule === r.rrule} onClick={() => setRrule(r.rrule)}>
              {repeatLabel(r.rrule, null) ?? "Personalizada"}
            </FilterChip>
          )}
        </div>
      </div>
      <Button
        size="lg"
        disabled={!dirty || !title.trim() || !time}
        onClick={() => {
          actions.update(r, patch);
          onDone();
        }}
      >
        Guardar
      </Button>
      <div className="flex gap-2">
        {(r.status === "scheduled" || r.status === "sent") && (
          <Button
            variant="secondary"
            icon="check"
            className="flex-1"
            onClick={() => {
              actions.done(r);
              onDone();
            }}
          >
            Listo
          </Button>
        )}
        <Button
          variant="danger"
          icon="delete"
          className="flex-1"
          onClick={() => {
            actions.cancel(r);
            toast({ icon: "delete", message: `"${r.title}" cancelado` });
            onDone();
          }}
        >
          Cancelar recordatorio
        </Button>
      </div>
    </div>
  );
}

/** Recordatorios: upcoming (soonest first) and recent (sent, done, missed, cancelled). */
export function RemindersScreen({ fab, quickAdd }: { fab: ReactNode; quickAdd: ReactNode }) {
  const [view, setView] = useState<"upcoming" | "recent">("upcoming");
  const q = useReminders({ view });
  const ui = useReminderUi();
  const items = q.data?.reminders ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Recordatorios" />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "upcoming", label: "Próximos" },
          { value: "recent", label: "Recientes" },
        ]}
      />
      {q.isPending ? (
        <TimelineSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications"
          title={view === "upcoming" ? "Sin recordatorios" : "Nada todavía"}
          body={view === "upcoming" ? "Probá con + y “mañana 9 llamar al contador”." : "Acá aparecen los que ya sonaron."}
        />
      ) : (
        <div className="flex flex-col gap-2">{items.map((r) => ui.row(r, { showStatus: view === "recent" }))}</div>
      )}
      {fab}
      {quickAdd}
      {ui.sheets}
    </div>
  );
}

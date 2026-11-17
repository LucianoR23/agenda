"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, get } from "@/client/api";
import { type EventInput, useEventActions } from "@/client/event-actions";
import { byStart, spanOf } from "@/client/event-cache";
import { useCalendars, useDirect, useEvents } from "@/client/queries";
import { localToIso } from "@/client/reminder-actions";
import type { AgendaEvent, Event } from "@/client/types";
import { Button, Fab, FilterChip, Segmented, TextArea, TextField, Toggle } from "../components/controls";
import { DatePicker, TimePicker } from "../components/date-picker";
import { Banner } from "../components/feedback";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { EmptyState, RowGroup, SheetRow, TimelineSkeleton } from "../components/surfaces";
import { cx } from "../cx";
import { useDeepLink } from "../deep-link";
import { addDays, dayLabel, todayLocal, userTimeZone } from "../time";
import { repeatLabel } from "./task-sheets";

// ---------- formatting ----------

const zoned = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(userTimeZone());
const hhmm = (iso: string) => zoned(iso).toPlainTime().toString({ smallestUnit: "minute" });

/** "Todo el día", "10:00–11:00", "10:00". */
export function timeRange(e: AgendaEvent): string {
  if (e.allDay) return "Todo el día";
  if (!e.startsAt) return "";
  if (!e.endsAt || e.endsAt === e.startsAt) return hhmm(e.startsAt);
  const sameDay = zoned(e.startsAt).toPlainDate().equals(zoned(e.endsAt).toPlainDate());
  return sameDay
    ? `${hhmm(e.startsAt)}–${hhmm(e.endsAt)}`
    : `${hhmm(e.startsAt)} → ${dayLabel(zoned(e.endsAt).toPlainDate().toString()).toLowerCase()} ${hhmm(e.endsAt)}`;
}

const OFFSETS: Array<[number, string]> = [
  [0, "Al empezar"],
  [10, "10 min"],
  [15, "15 min"],
  [30, "30 min"],
  [60, "1 h"],
  [1440, "1 día"],
];
const offsetLabel = (m: number) => OFFSETS.find(([v]) => v === m)?.[1] ?? (m % 60 === 0 ? `${m / 60} h` : `${m} min`);

/** The dot that says where an event comes from: the calendar's color, or the accent for local events. */
function SourceDot({ e }: { e: AgendaEvent }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent"
      style={e.calendar?.color ? { backgroundColor: e.calendar.color } : undefined}
    />
  );
}

export function EventRow({ event: e, onOpen }: { event: AgendaEvent; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx("flex min-h-14 w-full items-start gap-3 rounded-lg bg-surface px-3.5 py-2.5 text-left", e.tentative && "opacity-70")}
    >
      <SourceDot e={e} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] text-text">{e.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted">
          <span>{timeRange(e)}</span>
          {e.location && <span className="truncate">· {e.location}</span>}
          {e.recurring && <Icon name="repeat" size={14} label="Se repite" />}
          {e.reminderOffsets.length > 0 && <Icon name="notifications" size={14} label="Con aviso" />}
          {e.readOnly && <span>· {e.calendar?.name ?? "Google"}</span>}
          {e.tentative && <span>· a confirmar</span>}
        </span>
      </span>
      {e.readOnly && <Icon name="lock" size={16} className="mt-1 text-muted" label="Solo lectura" />}
    </button>
  );
}

// ---------- sheets ----------

type Draft = { date: string; time: string | null };
type Sheet = { kind: "new"; draft: Draft } | { kind: "edit"; event: AgendaEvent } | { kind: "external"; event: AgendaEvent } | null;

/** Tap = local editor or the read-only Google sheet; `openNew` starts an event on a day (and hour). */
export function useEventUi() {
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);
  const open = (e: AgendaEvent) => setSheet(e.readOnly ? { kind: "external", event: e } : { kind: "edit", event: e });
  const row = (e: AgendaEvent) => <EventRow key={e.id} event={e} onOpen={() => open(e)} />;
  const sheets = (
    <>
      <BottomSheet open={sheet?.kind === "new" || sheet?.kind === "edit"} onClose={close} label="Evento">
        {sheet?.kind === "new" && <EventEditor draft={sheet.draft} onDone={close} />}
        {sheet?.kind === "edit" && <EventEditor occurrence={sheet.event} onDone={close} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "external"} onClose={close} label="Evento de Google Calendar">
        {sheet?.kind === "external" && <ExternalEventSheet event={sheet.event} onDone={close} />}
      </BottomSheet>
    </>
  );
  return { row, open, sheets, openNew: (draft: Draft) => setSheet({ kind: "new", draft }) };
}

const REPEATS: Array<[string | null, string]> = [
  [null, "Nunca"],
  ["FREQ=DAILY", "Todos los días"],
  ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Días de semana"],
  ["FREQ=WEEKLY", "Cada semana"],
  ["FREQ=MONTHLY", "Cada mes"],
  ["FREQ=YEARLY", "Cada año"],
];

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** A new start keeps the event's length (default 1 h), ending at 23:59 at the latest. */
function moveEnd(oldStart: string | null, oldEnd: string | null, next: string): string {
  const length = oldStart && oldEnd && oldEnd > oldStart ? minutesOf(oldEnd) - minutesOf(oldStart) : 60;
  return fromMinutes(Math.min(minutesOf(next) + length, 23 * 60 + 59));
}

/** Timed events overlapping a slot, the same rule as the API's `conflicts` (a slot without an end is a moment). */
function clashes(list: AgendaEvent[], startsAt: string, endsAt: string | null, eventId: string | null): AgendaEvent[] {
  const s = Temporal.Instant.from(startsAt);
  const e = endsAt ? Temporal.Instant.from(endsAt) : s;
  return list.filter((o) => {
    if (o.allDay || !o.startsAt || (eventId && o.eventId === eventId)) return false;
    const os = Temporal.Instant.from(o.startsAt);
    const oe = o.endsAt ? Temporal.Instant.from(o.endsAt) : os;
    return (Temporal.Instant.compare(s, oe) < 0 && Temporal.Instant.compare(os, e) < 0) || s.equals(os);
  });
}

const plusHour = (t: string) => {
  const h = Number(t.slice(0, 2));
  return h >= 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}${t.slice(2)}`;
};

/**
 * Local event editor (new or existing). A recurring event is edited as a series, so its fields come from the series
 * (GET /api/events/{id}), not from the tapped occurrence.
 */
function EventEditor({ draft, occurrence, onDone }: { draft?: Draft; occurrence?: AgendaEvent; onDone: () => void }) {
  const series = useQuery({
    queryKey: ["event", occurrence?.eventId],
    queryFn: () => get<Event>(`/api/events/${occurrence?.eventId}`),
    enabled: Boolean(occurrence?.recurring && occurrence.eventId),
    staleTime: 0,
  });
  if (occurrence?.recurring && !series.data) {
    return series.isError ? (
      <p className="text-body-sm text-text2">No pude cargar el evento (¿sin conexión?). Probá de nuevo con conexión.</p>
    ) : (
      <TimelineSkeleton heights={[56, 56, 120]} />
    );
  }
  const base: EventInput | null = occurrence
    ? {
        ...(series.data ?? occurrence),
        notes: (series.data ?? occurrence).notes,
        location: (series.data ?? occurrence).location,
      }
    : null;
  return <EventForm key={occurrence?.id ?? "new"} base={base} eventId={occurrence?.eventId ?? null} draft={draft} onDone={onDone} />;
}

function EventForm({
  base,
  eventId,
  draft,
  onDone,
}: {
  base: EventInput | null;
  eventId: string | null;
  draft?: Draft | undefined;
  onDone: () => void;
}) {
  const actions = useEventActions();
  const toast = useToast();
  const today = todayLocal();
  const startZ = base?.startsAt ? zoned(base.startsAt) : null;
  const endZ = base?.endsAt ? zoned(base.endsAt) : null;
  const [title, setTitle] = useState(base?.title ?? "");
  const [allDay, setAllDay] = useState(base?.allDay ?? (draft ? draft.time === null : false));
  const [date, setDate] = useState(base?.startDate ?? startZ?.toPlainDate().toString() ?? draft?.date ?? today);
  const [days, setDays] = useState(
    base?.allDay && base.startDate && base.endDate ? Temporal.PlainDate.from(base.startDate).until(base.endDate).days : 1,
  );
  const [start, setStart] = useState<string | null>(startZ?.toPlainTime().toString({ smallestUnit: "minute" }) ?? draft?.time ?? "09:00");
  const [end, setEnd] = useState<string | null>(
    endZ?.toPlainTime().toString({ smallestUnit: "minute" }) ?? (draft?.time ? plusHour(draft.time) : start ? plusHour(start) : null),
  );
  const [location, setLocation] = useState(base?.location ?? "");
  const [notes, setNotes] = useState(base?.notes ?? "");
  const [rrule, setRrule] = useState<string | null>(base?.rrule ?? null);
  const [offsets, setOffsets] = useState<number[]>(base?.reminderOffsets ?? []);
  const [open, setOpen] = useState<"date" | "start" | "end" | null>(null);

  const endBeforeStart = !allDay && start && end && end < start;
  const input = (): EventInput => ({
    title: title.trim(),
    notes: notes.trim() || null,
    location: location.trim() || null,
    allDay,
    ...(allDay
      ? { startDate: date, endDate: addDays(date, days) }
      : {
          startsAt: localToIso(date, start ?? "09:00"),
          // an end before the start means "the next day" (e.g. 22:00–01:00)
          endsAt: end ? localToIso(endBeforeStart ? addDays(date, 1) : date, end) : null,
        }),
    rrule,
    reminderOffsets: offsets,
  });

  // what the slot overlaps, from the cached day (works offline; the API checks again on save)
  const dayEvents = useEvents(date, endBeforeStart ? addDays(date, 1) : date).data?.events ?? [];
  const slot = allDay || !start ? null : input();
  const overlap = slot?.startsAt ? clashes(dayEvents, slot.startsAt, slot.endsAt ?? null, eventId) : [];

  const save = () => {
    if (!title.trim()) return;
    if (eventId) actions.update(eventId, input());
    else {
      actions.create(input());
      toast({ icon: "event", message: `Evento para ${dayLabel(date, today).toLowerCase()}` });
    }
    onDone();
  };
  const custom = base?.rrule && !REPEATS.some(([v]) => v === base.rrule);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextField
        label="Título"
        autoFocus={!eventId}
        placeholder="Dentista"
        value={title}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
      />
      <RowGroup>
        <SheetRow icon="schedule" label="Todo el día" trailing={<Toggle checked={allDay} onChange={setAllDay} label="Todo el día" />} />
        <SheetRow icon="event" label={dayLabel(date, today)} chevron onClick={() => setOpen(open === "date" ? null : "date")} />
        {!allDay && (
          <>
            <SheetRow
              icon="schedule"
              label="Empieza"
              value={start ?? "—"}
              chevron
              onClick={() => setOpen(open === "start" ? null : "start")}
            />
            <SheetRow
              icon="update"
              label="Termina"
              value={end ? `${end}${endBeforeStart ? " (+1 día)" : ""}` : "—"}
              chevron
              onClick={() => setOpen(open === "end" ? null : "end")}
            />
          </>
        )}
      </RowGroup>
      {overlap.length > 0 && (
        <Banner kind="info" title="Se superpone con">
          {overlap.map((o) => `${o.title} (${timeRange(o)})`).join(" · ")}
        </Banner>
      )}
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
      {open === "start" && (
        <TimePicker
          value={start}
          onChange={(t) => {
            setStart(t);
            if (t) setEnd(moveEnd(start, end, t));
          }}
        />
      )}
      {open === "end" && <TimePicker value={end} onChange={setEnd} />}
      {allDay && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Dura</span>
          <Segmented
            value={String(Math.min(days, 7))}
            onChange={(v) => setDays(Number(v))}
            options={[1, 2, 3, 7].map((d) => ({ value: String(d), label: d === 1 ? "1 día" : `${d} días` }))}
          />
        </div>
      )}
      <TextField
        label="Lugar"
        placeholder="Lugar (opcional)"
        value={location}
        maxLength={500}
        onChange={(e) => setLocation(e.target.value)}
      />
      <TextArea label="Nota" placeholder="Nota (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption text-muted">Repetir</legend>
        <div className="flex flex-wrap gap-2">
          {REPEATS.map(([value, label]) => (
            <FilterChip key={label} selected={rrule === value} onClick={() => setRrule(value)}>
              {label}
            </FilterChip>
          ))}
          {custom && base?.rrule && (
            <FilterChip selected={rrule === base.rrule} onClick={() => setRrule(base.rrule ?? null)}>
              {repeatLabel(base.rrule, null) ?? "Personalizada"}
            </FilterChip>
          )}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption text-muted">{allDay ? "Avisarme (desde las 9:00 de ese día)" : "Avisarme antes"}</legend>
        <div className="flex flex-wrap gap-2">
          {OFFSETS.map(([m, label]) => (
            <FilterChip
              key={m}
              selected={offsets.includes(m)}
              aria-pressed={offsets.includes(m)}
              onClick={() => setOffsets((o) => (o.includes(m) ? o.filter((x) => x !== m) : o.length < 5 ? [...o, m] : o))}
            >
              {label}
            </FilterChip>
          ))}
        </div>
      </fieldset>
      <Button size="lg" type="submit" disabled={!title.trim() || (!allDay && !start)}>
        Guardar
      </Button>
      {eventId && (
        <Button
          variant="danger"
          icon="delete"
          onClick={() => {
            actions.remove(eventId);
            toast({ icon: "delete", message: `"${title}" borrado` });
            onDone();
          }}
        >
          {base?.rrule ? "Borrar la serie" : "Borrar evento"}
        </Button>
      )}
      {base?.rrule && <p className="text-caption text-muted">Los cambios se aplican a todas las repeticiones.</p>}
    </form>
  );
}

/** A Google/iCal event: details, open in Google Calendar, and "Recordarme". */
function ExternalEventSheet({ event: e, onDone }: { event: AgendaEvent; onDone: () => void }) {
  const direct = useDirect();
  const toast = useToast();
  const remind = async (body: { minutesBefore: number } | { at: string }, label: string) => {
    try {
      await direct("POST", `/api/external-events/${e.externalEventId}/remind`, body, [["reminders"]]);
      toast({ icon: "notifications", message: `Te aviso ${label}` });
      onDone();
    } catch (err) {
      toast({ icon: "info", message: (err as Error).message });
    }
  };
  const day = e.startDate ?? (e.startsAt ? zoned(e.startsAt).toPlainDate().toString() : todayLocal());
  const startsIn = e.startsAt ? Temporal.Now.instant().until(Temporal.Instant.from(e.startsAt)).total("minutes") : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <SourceDot e={e} />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-title text-text">{e.title}</h2>
          <p className="text-body-sm text-text2">
            {dayLabel(day)} · {timeRange(e)}
          </p>
          {e.location && <p className="text-body-sm text-text2">{e.location}</p>}
          <p className="text-caption text-muted">
            {e.calendar?.name ?? "Google Calendar"} · solo lectura{e.tentative ? " · a confirmar" : ""}
          </p>
        </div>
      </div>
      {e.htmlLink && (
        <Button variant="secondary" icon="open_in_new" href={e.htmlLink}>
          Abrir en Google Calendar
        </Button>
      )}
      <SectionLabel>Recordarme</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {e.allDay ? (
          <>
            <FilterChip onClick={() => void remind({ at: localToIso(day, "09:00") }, `${dayLabel(day).toLowerCase()} a las 9:00`)}>
              Ese día a las 9:00
            </FilterChip>
            <FilterChip onClick={() => void remind({ at: localToIso(addDays(day, -1), "20:00") }, "el día anterior a las 20:00")}>
              El día anterior a las 20:00
            </FilterChip>
          </>
        ) : (
          [5, 10, 15, 30, 60]
            .filter((m) => m < startsIn)
            .map((m) => (
              <FilterChip key={m} onClick={() => void remind({ minutesBefore: m }, `${offsetLabel(m)} antes`)}>
                {offsetLabel(m)} antes
              </FilterChip>
            ))
        )}
      </div>
      <p className="text-caption text-muted">Si el evento se mueve en Google, el aviso se mueve con él.</p>
    </div>
  );
}

// ---------- Calendario ----------

const AGENDA_DAYS = 14;

/** The next full hour in the user's zone (a new event's default start), 23:00 at the latest. */
const nextHour = () => `${String(Math.min(Temporal.Now.zonedDateTimeISO(userTimeZone()).hour + 1, 23)).padStart(2, "0")}:00`;

/** Group occurrences by day (multi-day all-day events appear on each of their days within the range). */
function byDay(events: AgendaEvent[], from: string, to: string): Array<[string, AgendaEvent[]]> {
  const days = new Map<string, AgendaEvent[]>();
  const push = (d: string, e: AgendaEvent) => {
    if (d < from || d > to) return;
    days.set(d, [...(days.get(d) ?? []), e]);
  };
  for (const e of events) {
    if (e.allDay && e.startDate && e.endDate) {
      for (let d = e.startDate; d < e.endDate; d = addDays(d, 1)) push(d, e);
    } else if (e.startsAt) {
      const d = zoned(e.startsAt).toPlainDate().toString();
      push(d < from ? from : d, e);
    }
  }
  return [...days].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** Calendar sync on open (only if the last one is older than 2 minutes), then fresh events. */
function useSyncOnOpen() {
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    api("POST", "/api/calendars/sync", { ifOlderThanSeconds: 120 })
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: ["events"] }), qc.invalidateQueries({ queryKey: ["calendars"] })]))
      .catch(() => {});
  }, [qc]);
}

/** A local event as the editor's occurrence (deep links fetch the event itself). */
function asAgendaEvent(e: Event): AgendaEvent {
  return {
    id: e.id,
    eventId: e.id,
    externalEventId: null,
    source: "local",
    readOnly: false,
    title: e.title,
    notes: e.notes,
    location: e.location,
    allDay: e.allDay,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    startDate: e.startDate,
    endDate: e.endDate,
    whenText: e.whenText,
    recurring: e.rrule !== null,
    rrule: e.rrule,
    reminderOffsets: e.reminderOffsets,
    tentative: false,
    htmlLink: null,
    calendar: null,
    url: e.url,
  };
}

export function CalendarScreen() {
  const [view, setView] = useState<"agenda" | "week">("agenda");
  const ui = useEventUi();
  useSyncOnOpen();
  useDeepLink<Event>(
    "event",
    (id) => `/api/events/${id}`,
    (e) => ui.open(asAgendaEvent(e)),
  );
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Calendario" />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "agenda", label: "Agenda" },
          { value: "week", label: "Semana" },
        ]}
      />
      {view === "agenda" ? <AgendaView ui={ui} /> : <WeekView ui={ui} />}
      <div className="fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 md:bottom-8">
        <Fab label="Nuevo evento" onClick={() => ui.openNew({ date: todayLocal(), time: nextHour() })} />
      </div>
      {ui.sheets}
    </div>
  );
}

type Ui = ReturnType<typeof useEventUi>;

function AgendaView({ ui }: { ui: Ui }) {
  const today = todayLocal();
  const [span, setSpan] = useState(AGENDA_DAYS);
  const to = addDays(today, span - 1);
  const q = useEvents(today, to);
  const calendars = useCalendars().data;
  const groups = byDay((q.data?.events ?? []).slice().sort(byStart), today, to);
  if (q.isPending) return <TimelineSkeleton />;
  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 ? (
        <EmptyState
          icon="calendar_month"
          title="Sin eventos"
          body={
            calendars && !calendars.google.connected && calendars.sources.length === 0
              ? "Agregá uno con + o conectá Google Calendar en Ajustes."
              : `Nada en las próximas ${span / 7} semanas.`
          }
          actions={
            calendars && !calendars.google.connected && calendars.sources.length === 0 ? (
              <Button variant="secondary" href="/ajustes/calendario">
                Conectar Google Calendar
              </Button>
            ) : undefined
          }
        />
      ) : (
        groups.map(([day, events]) => (
          <section key={day} className="flex flex-col gap-2" aria-label={dayLabel(day, today)}>
            <div className="flex items-center justify-between">
              <SectionLabel>{dayLabel(day, today)}</SectionLabel>
              <button
                type="button"
                onClick={() => ui.openNew({ date: day, time: day === today ? nextHour() : "09:00" })}
                aria-label={`Nuevo evento el ${dayLabel(day, today)}`}
                className="flex size-11 items-center justify-center text-muted"
              >
                <Icon name="add" />
              </button>
            </div>
            {events.map(ui.row)}
          </section>
        ))
      )}
      {span < 91 && (
        <Button variant="ghost" onClick={() => setSpan(span + AGENDA_DAYS)}>
          Ver más días
        </Button>
      )}
    </div>
  );
}

// ---------- week ----------

const HOUR_PX = 44;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOW = ["L", "M", "M", "J", "V", "S", "D"];

/** Side-by-side lanes for overlapping timed events of one day. */
function lanes(events: Array<{ e: AgendaEvent; top: number; bottom: number }>) {
  const out: Array<{ e: AgendaEvent; top: number; bottom: number; lane: number; lanes: number }> = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ ...c, lanes: n });
    cluster = [];
  };
  for (const ev of [...events].sort((a, b) => a.top - b.top)) {
    if (ev.top >= clusterEnd) flush();
    const ends: number[] = [];
    for (const c of cluster) ends[c.lane] = Math.max(ends[c.lane] ?? -1, c.bottom);
    let lane = ends.findIndex((end) => end <= ev.top);
    if (lane < 0) lane = ends.length;
    cluster.push({ ...ev, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, ev.bottom);
  }
  flush();
  return out;
}

function WeekView({ ui }: { ui: Ui }) {
  const today = todayLocal();
  const [weekStart, setWeekStart] = useState(() => addDays(today, 1 - Temporal.PlainDate.from(today).dayOfWeek));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const last = days[6] as string;
  const q = useEvents(weekStart, last);
  const events = q.data?.events ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_PX });
  }, []);
  const tz = userTimeZone();
  const allDay = byDay(
    events.filter((e) => e.allDay),
    weekStart,
    last,
  );
  const timed = (day: string) =>
    lanes(
      events
        .filter((e) => !e.allDay && e.startsAt)
        .flatMap((e) => {
          const s = spanOf(e, tz);
          const dayStart = Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: tz }).toInstant();
          const dayEnd = dayStart.add({ hours: 24 });
          if (Temporal.Instant.compare(s.start, dayEnd) >= 0 || Temporal.Instant.compare(s.end, dayStart) < 0) return [];
          if (Temporal.Instant.compare(s.end, dayStart) === 0 && Temporal.Instant.compare(s.start, dayStart) < 0) return [];
          const top = Math.max(0, dayStart.until(s.start).total("minutes"));
          const bottom = Math.min(24 * 60, dayStart.until(s.end).total("minutes"));
          return [{ e, top, bottom: Math.max(bottom, top + 20) }];
        }),
    );
  const label = `${dayLabel(weekStart, today).replace(/^(Hoy|Ayer|Mañana) · /, "")} – ${dayLabel(last, today).replace(/^(Hoy|Ayer|Mañana) · /, "")}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Semana anterior"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="flex size-11 items-center justify-center text-text2"
        >
          <Icon name="chevron_left" />
        </button>
        <button
          type="button"
          onClick={() => setWeekStart(addDays(today, 1 - Temporal.PlainDate.from(today).dayOfWeek))}
          className="text-body-sm text-text"
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="Semana siguiente"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="flex size-11 items-center justify-center text-text2"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <div className="grid grid-cols-[32px_repeat(7,minmax(0,1fr))] gap-px">
        <span />
        {days.map((d, i) => (
          <span
            key={d}
            className={cx("flex flex-col items-center rounded-md py-1 text-caption", d === today ? "bg-raised text-text" : "text-muted")}
          >
            <span>{DOW[i]}</span>
            <span className="font-mono text-[13px]">{Number(d.slice(8))}</span>
          </span>
        ))}
        {allDay.length > 0 && (
          <>
            <span />
            {days.map((d) => (
              <span key={d} className="flex min-w-0 flex-col gap-px">
                {(allDay.find(([day]) => day === d)?.[1] ?? []).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => ui.open(e)}
                    className="truncate rounded-[6px] bg-surface2 px-1 py-0.5 text-left text-[11px] text-text"
                    style={e.calendar?.color ? { boxShadow: `inset 3px 0 0 ${e.calendar.color}` } : undefined}
                  >
                    {e.title}
                  </button>
                ))}
              </span>
            ))}
          </>
        )}
      </div>
      <div ref={scroller} className="max-h-[60vh] overflow-y-auto rounded-lg bg-surface">
        <div className="relative grid grid-cols-[32px_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
          <div className="relative">
            {HOURS.map((h) => (
              <span key={h} className="absolute right-1 font-mono text-[10px] text-muted" style={{ top: h * HOUR_PX - 6 }}>
                {h > 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn key={d} day={d} items={timed(d)} ui={ui} />
          ))}
        </div>
      </div>
      {q.isPending && <p className="text-caption text-muted">Cargando…</p>}
    </div>
  );
}

function DayColumn({ day, items, ui }: { day: string; items: ReturnType<typeof lanes>; ui: Ui }) {
  const px = HOUR_PX / 60;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid column with event buttons inside; each hour slot is its own button
    <div role="group" aria-label={dayLabel(day)} className="relative border-l border-border">
      {HOURS.map((h) => (
        <button
          key={h}
          type="button"
          aria-label={`Nuevo evento ${dayLabel(day).toLowerCase()} a las ${h}:00`}
          onClick={() => ui.openNew({ date: day, time: `${String(h).padStart(2, "0")}:00` })}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: h * HOUR_PX, height: HOUR_PX }}
        />
      ))}
      {items.map(({ e, top, bottom, lane, lanes: n }) => (
        <button
          key={e.id}
          type="button"
          onClick={() => ui.open(e)}
          className={cx(
            "absolute overflow-hidden rounded-[6px] bg-raised px-0.5 text-left text-[10px] leading-tight text-text",
            e.tentative && "opacity-70",
          )}
          style={{
            top: top * px,
            height: Math.max((bottom - top) * px, 16),
            left: `${(lane / n) * 100}%`,
            width: `${100 / n}%`,
            boxShadow: `inset 2px 0 0 ${e.calendar?.color ?? "var(--accent)"}`,
          }}
        >
          {e.title}
        </button>
      ))}
    </div>
  );
}

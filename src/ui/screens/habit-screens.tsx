"use client";

import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { get } from "@/client/api";
import { useDirect, useHabits, useSleep } from "@/client/queries";
import { localToIso } from "@/client/reminder-actions";
import { useTrackingActions } from "@/client/tracking-actions";
import type { HabitProgress, SleepLog } from "@/client/types";
import { Button, Fab, FilterChip, Ring, Segmented, StreakChip, TextField } from "../components/controls";
import { TimePicker } from "../components/date-picker";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { EmptyState, HeatCell, RowGroup, SheetRow, TimelineSkeleton } from "../components/surfaces";
import { cx } from "../cx";
import { addDays, dayLabel, haptic, todayLocal, userTimeZone } from "../time";

// ---------- one habit ----------

const periodText = (h: HabitProgress) => {
  const unit = h.unit ? ` ${h.unit}` : "";
  if (h.targetPeriod === "week") return `${h.period.count}${unit}/${h.targetCount} esta semana`;
  if (h.kind === "numeric") return `${h.period.count}${unit} de ${h.targetCount} hoy`;
  return h.period.met ? "Hecho hoy" : "Pendiente hoy";
};
const streakUnit = (h: HabitProgress, n: number) => (h.targetPeriod === "week" ? "sem" : n === 1 ? "día" : "días");

/** Tap: check / uncheck (yes/no) or enter the value (numeric). The ring shows the period's progress. */
export function HabitRow({ habit: h, date, onValue }: { habit: HabitProgress; date: string; onValue: (h: HabitProgress) => void }) {
  const actions = useTrackingActions();
  const toast = useToast();
  const checked = Boolean(h.log?.done);
  const tap = () => {
    if (h.kind === "numeric") return onValue(h);
    haptic();
    actions.logHabit(h, date, { done: !checked });
    if (!checked) toast({ icon: "check_circle", message: `${h.name} ✓` });
  };
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg bg-surface px-3.5 py-2.5">
      {h.targetPeriod === "week" || h.kind === "numeric" ? (
        <Ring value={h.period.count} total={h.period.target} size={48} label={`${h.name}: ${periodText(h)}`} />
      ) : (
        <span
          className={cx(
            "flex size-12 items-center justify-center rounded-full",
            checked ? "bg-accent text-on-accent" : "bg-surface2 text-muted",
          )}
        >
          <Icon name={checked ? "check" : "radio_button_unchecked"} />
        </span>
      )}
      <button
        type="button"
        onClick={tap}
        className="flex min-w-0 flex-1 flex-col text-left"
        aria-pressed={h.kind === "boolean" ? checked : undefined}
      >
        <span className="truncate text-[15px] text-text">{h.name}</span>
        <span className="text-caption text-muted">
          {periodText(h)}
          {h.taskTag ? ` · +${h.taskTag}` : ""}
        </span>
      </button>
      {h.streak.current > 0 && <StreakChip count={h.streak.current} unit={streakUnit(h, h.streak.current)} />}
    </div>
  );
}

/** Numeric habit: the day's value. */
function ValueSheet({ habit: h, date, onDone }: { habit: HabitProgress; date: string; onDone: () => void }) {
  const actions = useTrackingActions();
  const [value, setValue] = useState(h.log?.value ? String(h.log.value) : "");
  const n = Number(value.replace(",", "."));
  const save = (v: number | null) => {
    actions.logHabit(h, date, { value: v });
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number.isFinite(n) && n >= 0) save(n);
      }}
    >
      <h2 className="text-title text-text">{h.name}</h2>
      <p className="text-body-sm text-text2">
        Meta: {h.targetCount} {h.unit ?? ""} por {h.targetPeriod === "week" ? "semana" : "día"}
      </p>
      <TextField
        label={`Cantidad (${h.unit ?? "valor"})`}
        hideLabel={false}
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {[h.targetCount, Math.round(h.targetCount / 2), h.targetCount * 2]
          .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
          .map((v) => (
            <FilterChip key={v} onClick={() => setValue(String(v))}>
              {v} {h.unit ?? ""}
            </FilterChip>
          ))}
      </div>
      <Button size="lg" type="submit" disabled={!value || !Number.isFinite(n) || n < 0}>
        Guardar
      </Button>
      {h.log && (
        <Button variant="ghost" onClick={() => save(null)}>
          Borrar el valor de {dayLabel(date).toLowerCase()}
        </Button>
      )}
    </form>
  );
}

/** Hoy's habits (or any day's, for Historial). */
export function HabitsSection({ date = todayLocal(), title = "Hábitos" }: { date?: string; title?: string }) {
  const q = useHabits(date === todayLocal() ? undefined : date);
  const [valueHabit, setValueHabit] = useState<HabitProgress | null>(null);
  const habits = q.data?.habits ?? [];
  if (!habits.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <SectionLabel>{title}</SectionLabel>
      {habits.map((h) => (
        <HabitRow key={h.id} habit={h} date={date} onValue={setValueHabit} />
      ))}
      <BottomSheet open={valueHabit !== null} onClose={() => setValueHabit(null)} label="Cargar valor">
        {valueHabit && <ValueSheet habit={valueHabit} date={date} onDone={() => setValueHabit(null)} />}
      </BottomSheet>
    </section>
  );
}

// ---------- Hábitos screen ----------

const WEEKS = 12;

/** Last 12 weeks, Monday-first columns: a cell per day, filled when checked (numeric: share of the target). */
function Heatmap({ habit: h }: { habit: HabitProgress }) {
  const today = todayLocal();
  const end = addDays(today, 7 - Temporal.PlainDate.from(today).dayOfWeek);
  const from = addDays(end, -WEEKS * 7 + 1);
  const logs = useQuery({
    queryKey: ["habit-logs", h.id, from, end],
    queryFn: () =>
      get<{ logs: Array<{ date: string; value: number | null; done: boolean }> }>(`/api/habits/${h.id}/logs?from=${from}&to=${today}`),
  }).data?.logs;
  if (!logs) return <div className="h-[100px]" />;
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(from, i));
  return (
    <figure className="grid grid-flow-col grid-rows-7 gap-[3px]" aria-label={`${h.name}: últimas ${WEEKS} semanas`}>
      {days.map((d) => {
        const l = byDate.get(d);
        const v =
          d > today ? null : l ? (h.kind === "numeric" && h.targetPeriod === "day" ? Math.min(1, (l.value ?? 0) / h.targetCount) : 1) : 0;
        return <HeatCell key={d} value={v === 0 ? 0.08 : v} label={`${dayLabel(d)}: ${l ? "hecho" : "no"}`} />;
      })}
    </figure>
  );
}

export function HabitsScreen() {
  const q = useHabits(undefined, true);
  const [editing, setEditing] = useState<HabitProgress | "new" | null>(null);
  const habits = q.data?.habits ?? [];
  const active = habits.filter((h) => h.active);
  const archived = habits.filter((h) => !h.active);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Hábitos" />
      {q.isPending ? (
        <TimelineSkeleton />
      ) : habits.length === 0 ? (
        <EmptyState
          icon="local_fire_department"
          title="Sin hábitos"
          body="Creá uno (por ejemplo Gym 3 veces por semana) y marcalo desde Hoy."
          actions={<Button onClick={() => setEditing("new")}>Crear hábito</Button>}
        />
      ) : (
        <>
          {active.map((h) => (
            <section key={h.id} className="flex flex-col gap-3 rounded-lg bg-surface p-3.5" aria-label={h.name}>
              <button type="button" onClick={() => setEditing(h)} className="flex items-center gap-3 text-left">
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] text-text">{h.name}</span>
                  <span className="text-caption text-muted">
                    {h.targetCount}
                    {h.unit ? ` ${h.unit}` : h.targetPeriod === "week" ? " veces" : ""} por {h.targetPeriod === "week" ? "semana" : "día"}
                    {h.taskTag ? ` · se marca con +${h.taskTag}` : ""}
                  </span>
                </span>
                <span className="text-caption text-muted">mejor racha {h.streak.best}</span>
                <Icon name="edit" size={18} className="text-muted" />
              </button>
              <Heatmap habit={h} />
            </section>
          ))}
          {archived.length > 0 && (
            <>
              <SectionLabel>Archivados</SectionLabel>
              <RowGroup>
                {archived.map((h) => (
                  <SheetRow key={h.id} icon="inbox" label={h.name} chevron onClick={() => setEditing(h)} />
                ))}
              </RowGroup>
            </>
          )}
        </>
      )}
      <div className="fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 md:bottom-8">
        <Fab label="Nuevo hábito" onClick={() => setEditing("new")} />
      </div>
      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} label="Hábito">
        {editing && <HabitEditor habit={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </BottomSheet>
    </div>
  );
}

function HabitEditor({ habit: h, onDone }: { habit: HabitProgress | null; onDone: () => void }) {
  const direct = useDirect();
  const toast = useToast();
  const [name, setName] = useState(h?.name ?? "");
  const [kind, setKind] = useState<"boolean" | "numeric">(h?.kind ?? "boolean");
  const [period, setPeriod] = useState<"day" | "week">(h?.targetPeriod ?? "day");
  const [target, setTarget] = useState(String(h?.targetCount ?? 1));
  const [unit, setUnit] = useState(h?.unit ?? "");
  const [tag, setTag] = useState(h?.taskTag ?? "");
  const [confirm, setConfirm] = useState(false);
  const refresh = [["habits"], ["history"], ["metrics"], ["summary"]];
  const n = Number(target);
  const valid = name.trim() && Number.isInteger(n) && n >= 1;

  const run = async (method: string, path: string, body?: unknown, done?: string) => {
    try {
      await direct(method, path, body, refresh);
      if (done) toast({ icon: "check_circle", message: done });
      onDone();
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    }
  };
  const save = () => {
    const common = {
      name: name.trim(),
      targetCount: n,
      targetPeriod: period,
      unit: kind === "numeric" ? unit.trim() || null : null,
      taskTag: kind === "boolean" ? tag.trim().replace(/^\+/, "").toLowerCase() || null : null,
    };
    if (h) void run("PATCH", `/api/habits/${h.id}`, common);
    else void run("POST", "/api/habits", { ...common, kind }, `"${name.trim()}" creado`);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save();
      }}
    >
      <TextField
        label="Nombre"
        hideLabel={false}
        autoFocus={!h}
        placeholder="Gym"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      {!h && (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "boolean", label: "Sí / no" },
            { value: "numeric", label: "Con cantidad" },
          ]}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">Meta</span>
        <div className="flex items-center gap-2">
          <TextField
            label="Meta"
            inputMode="numeric"
            className="w-24"
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))}
          />
          {kind === "numeric" && (
            <TextField
              label="Unidad"
              className="flex-1"
              placeholder="páginas"
              value={unit}
              maxLength={20}
              onChange={(e) => setUnit(e.target.value)}
            />
          )}
          <span className="text-body-sm text-text2">{kind === "numeric" ? "" : "vez/veces"}</span>
        </div>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: "day", label: "Por día" },
            { value: "week", label: "Por semana" },
          ]}
        />
      </div>
      {kind === "boolean" && (
        <div className="flex flex-col gap-1.5">
          <TextField
            label="Etiqueta de tarea (opcional)"
            hideLabel={false}
            placeholder="gym"
            value={tag}
            maxLength={40}
            onChange={(e) => setTag(e.target.value)}
          />
          <p className="text-caption text-muted">
            Completar una tarea con +{tag.trim().replace(/^\+/, "") || "etiqueta"} marca este hábito ese día.
          </p>
        </div>
      )}
      <Button size="lg" type="submit" disabled={!valid}>
        {h ? "Guardar" : "Crear hábito"}
      </Button>
      {h && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            icon="inbox"
            onClick={() => void run("PATCH", `/api/habits/${h.id}`, { active: !h.active }, h.active ? "Archivado" : "Activo otra vez")}
          >
            {h.active ? "Archivar" : "Reactivar"}
          </Button>
          <Button variant="danger" className="flex-1" icon="delete" onClick={() => setConfirm(true)}>
            Borrar
          </Button>
        </div>
      )}
      {h && confirm && (
        <div className="flex flex-col gap-2 rounded-lg bg-danger-soft p-3.5">
          <p className="text-body-sm text-text">Se borra "{h.name}" con todo su historial. Para conservarlo, archivalo.</p>
          <Button variant="danger" onClick={() => void run("DELETE", `/api/habits/${h.id}`, undefined, "Hábito borrado")}>
            Borrar con su historial
          </Button>
        </div>
      )}
    </form>
  );
}

// ---------- sleep ----------

const local = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(userTimeZone());
const hhmm = (iso: string) => local(iso).toPlainTime().toString({ smallestUnit: "minute" });
export const duration = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;

/**
 * Hoy's sleep card. Evening (from 19:00): "Me voy a dormir". Morning (until 14:00): "Me levanté" when the night is
 * open, the quality when it's closed, or "¿Cómo dormiste?" to load it by hand.
 */
export function SleepCard() {
  const today = todayLocal();
  const hour = Temporal.Now.zonedDateTimeISO(userTimeZone()).hour;
  const tomorrow = addDays(today, 1);
  const logs = useSleep(today, tomorrow).data?.logs;
  const actions = useTrackingActions();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  if (!logs) return null;
  const morning = logs.find((l) => l.date === today) ?? null;
  const tonight = logs.find((l) => l.date === tomorrow) ?? null;

  let content: ReactNode = null;
  if (hour >= 19 || (tonight?.bedAt && !tonight.wakeAt)) {
    if (tonight?.bedAt) content = <p className="text-body-sm text-text2">Te acostaste a las {hhmm(tonight.bedAt)}. Que descanses.</p>;
    else
      content = (
        <Button
          size="lg"
          icon="bedtime"
          onClick={() => {
            actions.sleepEvent("bed");
            toast({ icon: "bedtime", message: "Que descanses" });
          }}
        >
          Me voy a dormir
        </Button>
      );
  } else if (hour < 14) {
    if (morning?.bedAt && !morning.wakeAt)
      content = (
        <Button size="lg" icon="light_mode" onClick={() => actions.sleepEvent("wake")}>
          Me levanté
        </Button>
      );
    else if (morning?.durationMinutes != null)
      content = (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-text2">
            Dormiste {duration(morning.durationMinutes)} ({hhmm(morning.bedAt as string)} → {hhmm(morning.wakeAt as string)})
          </p>
          {morning.quality === null && <Quality onPick={(quality) => actions.saveSleep(today, { quality })} />}
        </div>
      );
    else
      content = (
        <Button variant="secondary" icon="bedtime" onClick={() => setEdit(true)}>
          ¿Cómo dormiste?
        </Button>
      );
  }
  if (!content) return null;
  return (
    <section className="flex flex-col gap-2.5 rounded-lg bg-surface p-3.5" aria-label="Sueño">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[15px] text-text">
          <Icon name="dark_mode" className="text-accent" /> Sueño
        </span>
        <button
          type="button"
          onClick={() => setEdit(true)}
          className="flex size-11 items-center justify-center text-muted"
          aria-label="Cargar o corregir la noche"
        >
          <Icon name="edit" size={18} />
        </button>
      </div>
      {content}
      <BottomSheet open={edit} onClose={() => setEdit(false)} label="Sueño">
        {edit && <SleepEditor date={hour >= 19 ? tomorrow : today} log={hour >= 19 ? tonight : morning} onDone={() => setEdit(false)} />}
      </BottomSheet>
    </section>
  );
}

function Quality({ value, onPick }: { value?: number | null; onPick: (q: number) => void }) {
  const LABELS = ["Muy mal", "Mal", "Normal", "Bien", "Muy bien"];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-caption text-muted">¿Cómo dormiste?</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={value === i + 1}
            aria-label={label}
            onClick={() => onPick(i + 1)}
            className={cx("h-11 rounded-md font-mono text-body-sm", value === i + 1 ? "bg-accent text-on-accent" : "bg-surface2 text-text")}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Load or correct the night that ends on `date`: bedtime (the evening before, or after midnight), wake time, quality. */
function SleepEditor({ date, log, onDone }: { date: string; log: SleepLog | null; onDone: () => void }) {
  const actions = useTrackingActions();
  const [bed, setBed] = useState<string | null>(log?.bedAt ? hhmm(log.bedAt) : "23:30");
  const [wake, setWake] = useState<string | null>(log?.wakeAt ? hhmm(log.wakeAt) : "07:00");
  const [quality, setQuality] = useState<number | null>(log?.quality ?? null);
  const [open, setOpen] = useState<"bed" | "wake" | null>(null);
  // a bedtime from noon on is the evening before
  const bedIso = bed ? localToIso(bed >= "12:00" ? addDays(date, -1) : date, bed) : null;
  // tonight's night hasn't ended: only the bedtime can be loaded
  const ended = date <= todayLocal();
  const wakeIso = ended && wake ? localToIso(date, wake) : null;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Noche que termina {dayLabel(date).toLowerCase()}</h2>
      <RowGroup>
        <SheetRow icon="bedtime" label="Me acosté" value={bed ?? "—"} chevron onClick={() => setOpen(open === "bed" ? null : "bed")} />
        {ended && (
          <SheetRow
            icon="light_mode"
            label="Me levanté"
            value={wake ?? "—"}
            chevron
            onClick={() => setOpen(open === "wake" ? null : "wake")}
          />
        )}
      </RowGroup>
      {open === "bed" && <TimePicker value={bed} onChange={setBed} />}
      {open === "wake" && <TimePicker value={wake} onChange={setWake} />}
      <Quality value={quality} onPick={setQuality} />
      <Button
        size="lg"
        onClick={() => {
          actions.saveSleep(date, { bedAt: bedIso, ...(ended ? { wakeAt: wakeIso } : {}), quality });
          onDone();
        }}
      >
        Guardar
      </Button>
    </div>
  );
}

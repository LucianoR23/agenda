"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/client/api";
import { useDaySummary, useHistory, useMetrics, useReview } from "@/client/queries";
import type { DaySummary, Metrics, Task } from "@/client/types";
import { Button, FilterChip, Segmented, TextArea, TextField } from "../components/controls";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { BarChart, ChartCard, EmptyState, HeatCell, RowGroup, StatCard, TimelineSkeleton } from "../components/surfaces";
import { cx } from "../cx";
import { addDays, dayLabel, monthLabel, todayLocal, userTimeZone } from "../time";
import { duration } from "./habit-screens";

type Move = "tomorrow" | "inbox" | "drop";
const MOVES: Array<[Move, string]> = [
  ["tomorrow", "Mañana"],
  ["inbox", "Inbox"],
  ["drop", "Soltar"],
];
const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

/** "Cerrar el día" on Hoy from 20:00 until the day is closed. */
export function CloseDayCard() {
  const today = todayLocal();
  const hour = Temporal.Now.zonedDateTimeISO(userTimeZone()).hour;
  const review = useReview(today).data;
  if (hour < 20 || !review || review.review) return null;
  return (
    <Link href="/cierre" className="flex items-center gap-3 rounded-lg bg-surface p-3.5">
      <Icon name="wb_twilight" className="text-accent" />
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] text-text">Cerrar el día</span>
        <span className="text-caption text-muted">Qué hiciste, qué pasa a mañana, cómo estuviste</span>
      </span>
      <Icon name="chevron_right" className="text-muted" />
    </Link>
  );
}

/** Cierre del día: done today, pending → mañana (default) / Inbox / soltar, mood, highlights, note. */
export function CloseDayScreen() {
  const today = todayLocal();
  // before 05:00 the night still belongs to yesterday
  const date = Temporal.Now.zonedDateTimeISO(userTimeZone()).hour < 5 ? addDays(today, -1) : today;
  const summary = useDaySummary(date).data;
  if (!summary) return <TimelineSkeleton />;
  return <CloseDayForm key={summary.review?.version ?? 0} summary={summary} />;
}

function CloseDayForm({ summary: s }: { summary: DaySummary }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const r = s.review;
  const pending = [...s.tasks.overdue, ...s.tasks.pending];
  const [moves, setMoves] = useState<Record<string, Move>>(() => Object.fromEntries(pending.map((t) => [t.id, "tomorrow" as Move])));
  const [mood, setMood] = useState<number | null>(r?.mood ?? null);
  const [highlights, setHighlights] = useState<string[]>(() => [...(r?.highlights ?? []), "", "", ""].slice(0, 3));
  const [note, setNote] = useState(r?.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api("PUT", `/api/reviews/${s.date}`, {
        mood,
        note: note.trim() || null,
        highlights: highlights.map((h) => h.trim()).filter(Boolean),
        moves: pending.map((t) => ({ taskId: t.id, to: moves[t.id] ?? "tomorrow" })),
        ...(r ? { version: r.version } : {}),
      });
      await Promise.all(["tasks", "review", "summary", "history", "metrics"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast({ icon: "check_circle", message: "Día cerrado. Buenas noches." });
      router.push("/");
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Cierre del día" back="/" subtitle={dayLabel(s.date)} />

      <SectionLabel>Hiciste · {s.tasks.done.length}</SectionLabel>
      {s.tasks.done.length ? (
        <RowGroup>
          {s.tasks.done.map((t) => (
            <div key={t.id} className="flex min-h-12 items-center gap-3 px-3.5">
              <Icon name="check_circle" className="text-success" />
              <span className="text-[15px] text-text">{t.title}</span>
            </div>
          ))}
        </RowGroup>
      ) : (
        <p className="px-1 text-body-sm text-text2">Hoy no completaste tareas. Pasa.</p>
      )}
      {s.habits.length > 0 && (
        <p className="px-1 text-body-sm text-text2">
          Hábitos: {s.habits.filter((h) => h.period.met || h.log?.done).length} de {s.habits.length}
        </p>
      )}

      {pending.length > 0 && (
        <>
          <SectionLabel>Quedó pendiente · {pending.length}</SectionLabel>
          <div className="flex flex-col gap-2">
            {pending.map((t) => (
              <PendingRow
                key={t.id}
                task={t}
                date={s.date}
                value={moves[t.id] ?? "tomorrow"}
                onChange={(m) => setMoves({ ...moves, [t.id]: m })}
              />
            ))}
          </div>
        </>
      )}

      <SectionLabel>¿Cómo estuvo el día?</SectionLabel>
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Ánimo">
        {MOODS.map((m, i) => (
          // biome-ignore lint/a11y/useSemanticElements: emoji buttons in a radio group (one choice), styled like the rest
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mood === i + 1}
            aria-label={`Ánimo ${i + 1} de 5`}
            onClick={() => setMood(mood === i + 1 ? null : i + 1)}
            className={cx("h-14 rounded-lg text-[26px]", mood === i + 1 ? "bg-accent-soft ring-2 ring-accent" : "bg-surface")}
          >
            {m}
          </button>
        ))}
      </div>

      <SectionLabel>Lo mejor del día</SectionLabel>
      {highlights.map((h, i) => (
        <TextField
          // biome-ignore lint/suspicious/noArrayIndexKey: three fixed slots
          key={i}
          label={`Algo bueno ${i + 1}`}
          placeholder={i === 0 ? "Algo bueno de hoy" : "Otra cosa (opcional)"}
          value={h}
          maxLength={200}
          onChange={(e) => setHighlights(highlights.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <TextArea label="Nota" placeholder="Nota (opcional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="lg" disabled={saving} onClick={() => void save()}>
        {r ? "Guardar cambios" : "Cerrar el día"}
      </Button>
    </div>
  );
}

function PendingRow({ task: t, date, value, onChange }: { task: Task; date: string; value: Move; onChange: (m: Move) => void }) {
  const late = t.dueDate && t.dueDate < date;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-3">
      <span className="text-[15px] text-text">
        {t.title}
        {late && <span className="text-caption text-danger"> · vencida</span>}
        {t.rrule && <Icon name="repeat" size={14} className="ml-1 text-muted" label="Se repite" />}
      </span>
      <div className="flex gap-2" role="radiogroup" aria-label={`Qué hago con "${t.title}"`}>
        {MOVES.filter(([m]) => !(m === "inbox" && t.rrule)).map(([m, label]) => (
          <FilterChip key={m} role="radio" aria-checked={value === m} selected={value === m} onClick={() => onChange(m)}>
            {label}
          </FilterChip>
        ))}
      </div>
    </div>
  );
}

// ---------- Historial y métricas ----------

export function HistoryScreen() {
  const params = useSearchParams();
  const [picked, setTab] = useState<"history" | "metrics" | null>(null);
  // `/metricas` redirects here with ?tab=metricas
  const tab = picked ?? (params.get("tab") === "metricas" ? "metrics" : "history");
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Historial" />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "history", label: "Historial" },
          { value: "metrics", label: "Métricas" },
        ]}
      />
      {tab === "history" ? <HistoryView /> : <MetricsView />}
    </div>
  );
}

const DOW = ["L", "M", "M", "J", "V", "S", "D"];

function HistoryView() {
  const today = todayLocal();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const data = useHistory(month).data;
  const first = `${month}-01`;
  const blanks = Temporal.PlainDate.from(first).dayOfWeek - 1;
  const max = Math.max(1, ...(data?.days ?? []).map((d) => d.tasksDone));
  const shift = (n: number) => setMonth(Temporal.PlainYearMonth.from(month).add({ months: n }).toString());
  const days = data?.days ?? [];
  const reviewed = days.filter((d) => d.reviewed).length;
  const moods = days.map((d) => d.mood).filter((m): m is number => m !== null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => shift(-1)}
          className="flex size-11 items-center justify-center text-text2"
        >
          <Icon name="chevron_left" />
        </button>
        <span className="text-body text-text first-letter:uppercase">{monthLabel(first)}</span>
        <button
          type="button"
          aria-label="Mes siguiente"
          disabled={month >= today.slice(0, 7)}
          onClick={() => shift(1)}
          className="flex size-11 items-center justify-center text-text2 disabled:opacity-30"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 rounded-lg bg-surface p-3">
        {DOW.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: weekday initials repeat (M, M)
          <span key={i} className="text-center font-mono text-[11px] text-muted">
            {d}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: empty leading cells
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: Temporal.PlainDate.from(first).daysInMonth }, (_, i) => {
          const date = Temporal.PlainDate.from(first).add({ days: i }).toString();
          const d = days.find((x) => x.date === date);
          const future = date > today;
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              onClick={() => setDay(date)}
              className={cx("rounded-[5px]", date === today && "ring-2 ring-accent")}
            >
              <HeatCell
                value={future || !d ? null : d.tasksDone ? 0.25 + 0.75 * (d.tasksDone / max) : 0.06}
                label={`${dayLabel(date)}: ${d?.tasksDone ?? 0} tareas`}
              >
                {i + 1}
              </HeatCell>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-caption text-muted">Más intenso = más tareas completadas. Tocá un día para ver el detalle.</p>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Tareas hechas" value={String(days.reduce((s, d) => s + d.tasksDone, 0))} note="en el mes" />
        <StatCard
          label="Días cerrados"
          value={String(reviewed)}
          note={moods.length ? `ánimo ${(moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1)}/5` : "sin ánimo cargado"}
        />
      </div>
      <BottomSheet open={day !== null} onClose={() => setDay(null)} label="Detalle del día">
        {day && <DayDetail date={day} />}
      </BottomSheet>
    </div>
  );
}

function DayDetail({ date }: { date: string }) {
  const s = useDaySummary(date).data;
  if (!s) return <TimelineSkeleton heights={[56, 56]} />;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">{dayLabel(date)}</h2>
      {s.review?.mood && (
        <p className="text-body text-text">
          {MOODS[s.review.mood - 1]} {s.review.note ?? ""}
        </p>
      )}
      {s.review && s.review.highlights.length > 0 && (
        <ul className="flex flex-col gap-1 px-1">
          {s.review.highlights.map((h) => (
            <li key={h} className="text-body-sm text-text2">
              ✦ {h}
            </li>
          ))}
        </ul>
      )}
      <SectionLabel>Tareas hechas · {s.tasks.done.length}</SectionLabel>
      {s.tasks.done.length ? (
        <RowGroup>
          {s.tasks.done.map((t) => (
            <div key={t.id} className="flex min-h-11 items-center gap-3 px-3.5 text-[15px] text-text">
              <Icon name="check_circle" className="text-success" /> {t.title}
            </div>
          ))}
        </RowGroup>
      ) : (
        <p className="px-1 text-body-sm text-muted">Ninguna.</p>
      )}
      {s.habits.length > 0 && (
        <>
          <SectionLabel>Hábitos</SectionLabel>
          <RowGroup>
            {s.habits.map((h) => (
              <div key={h.id} className="flex min-h-11 items-center gap-3 px-3.5 text-[15px] text-text">
                <Icon
                  name={h.log?.done ? "check_circle" : "radio_button_unchecked"}
                  className={h.log?.done ? "text-success" : "text-muted"}
                />
                {h.name}
                {h.log?.value != null && (
                  <span className="text-muted">
                    · {h.log.value} {h.unit ?? ""}
                  </span>
                )}
              </div>
            ))}
          </RowGroup>
        </>
      )}
      {s.sleep?.durationMinutes != null && (
        <p className="px-1 text-body-sm text-text2">
          Dormiste {duration(s.sleep.durationMinutes)}
          {s.sleep.quality ? ` · calidad ${s.sleep.quality}/5` : ""}
        </p>
      )}
    </div>
  );
}

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

function MetricsView() {
  const today = todayLocal();
  const [range, setRange] = useState<"week" | "month" | "year">("week");
  const [date, setDate] = useState(today);
  const m = useMetrics(range, date).data;
  const step = (n: number) =>
    setDate(
      Temporal.PlainDate.from(date)
        .add(range === "week" ? { weeks: n } : range === "month" ? { months: n } : { years: n })
        .toString(),
    );
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        value={range}
        onChange={(r) => {
          setRange(r);
          setDate(today);
        }}
        options={[
          { value: "week", label: "Semana" },
          { value: "month", label: "Mes" },
          { value: "year", label: "Año" },
        ]}
      />
      {!m ? (
        <TimelineSkeleton />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Período anterior"
              onClick={() => step(-1)}
              className="flex size-11 items-center justify-center text-text2"
            >
              <Icon name="chevron_left" />
            </button>
            <span className="text-body text-text">{periodTitle(m)}</span>
            <button
              type="button"
              aria-label="Período siguiente"
              disabled={m.to >= today}
              onClick={() => step(1)}
              className="flex size-11 items-center justify-center text-text2 disabled:opacity-30"
            >
              <Icon name="chevron_right" />
            </button>
          </div>
          <MetricsBody m={m} />
        </>
      )}
    </div>
  );
}

const periodTitle = (m: Metrics) => {
  if (m.range === "year") return m.from.slice(0, 4);
  if (m.range === "month") return monthLabel(m.from).replace(/^./, (c) => c.toUpperCase());
  const f = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  return `${f(m.from)} – ${f(m.to)}`;
};

function MetricsBody({ m }: { m: Metrics }) {
  const total = m.sources.user + m.sources.sunday;
  if (m.tasks.done + m.tasks.created + m.sleep.nights + m.mood.days === 0 && m.habits.every((h) => h.total === 0))
    return (
      <EmptyState
        icon="insights"
        title="Sin datos en este período"
        body="Completá tareas, marcá hábitos o cargá tu sueño y van a aparecer acá."
      />
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Tareas hechas" value={String(m.tasks.done)} note={`${m.tasks.created} creadas`} />
        <StatCard label="A tiempo" value={pct(m.tasks.onTimeRate)} note={`${m.tasks.onTime} de ${m.tasks.withDue} con fecha`} />
        <StatCard
          label="Sueño promedio"
          value={m.sleep.avgMinutes === null ? "—" : duration(m.sleep.avgMinutes)}
          note={m.sleep.avgBedTime ? `${m.sleep.avgBedTime} → ${m.sleep.avgWakeTime}` : `${m.sleep.nights} noches`}
        />
        <StatCard
          label="Ánimo"
          value={m.mood.avg === null ? "—" : `${m.mood.avg}/5`}
          note={m.mood.days === 1 ? "1 día cerrado" : `${m.mood.days} días cerrados`}
        />
      </div>
      <ChartCard
        title="Tareas hechas"
        period={m.range === "year" ? "por mes" : "por día"}
        reading={m.tasks.buckets.map((b) => `${b.label}: ${b.done}`).join(", ")}
      >
        <BarChart
          bars={m.tasks.buckets.map((b) => ({ label: m.range === "month" && Number(b.label) % 5 !== 1 ? "" : b.label, value: b.done }))}
          color="var(--accent)"
        />
      </ChartCard>
      {m.habits.length > 0 && (
        <>
          <SectionLabel>Constancia de hábitos</SectionLabel>
          <RowGroup>
            {m.habits.map((h) => (
              <div key={h.id} className="flex min-h-12 items-center gap-3 px-3.5">
                <span className="flex-1 text-[15px] text-text">{h.name}</span>
                <span className="font-mono text-body-sm text-text2">
                  {h.met}/{h.total} {h.targetPeriod === "week" ? "sem" : "días"}
                </span>
                <span className="w-12 text-right font-mono text-body-sm text-text">{pct(h.rate)}</span>
              </div>
            ))}
          </RowGroup>
        </>
      )}
      {total > 0 && (
        <p className="px-1 text-body-sm text-text2">
          Creado: {m.sources.user} a mano · {m.sources.sunday} por Sunday ({Math.round((m.sources.sunday / total) * 100)}%)
        </p>
      )}
    </>
  );
}

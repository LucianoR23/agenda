"use client";

import { useState } from "react";
import { useMetrics } from "@/client/queries";
import type { Metrics } from "@/client/types";
import { BLOCK_TYPES, typeColor } from "../block-types";
import { Segmented, StreakChip } from "../components/controls";
import { Icon } from "../components/icon";
import { PageTitle } from "../components/page";
import { BarChart, ChartCard, EmptyState, StatCard, TimelineSkeleton } from "../components/surfaces";
import { duration, OUTCOME_LABEL } from "../format";
import { addDays, monthLabel, shortDow, todayART } from "../time";

type Range = "week" | "month" | "year";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

function shiftAnchor(anchor: string, range: Range, n: number) {
  if (range === "week") return addDays(anchor, 7 * n);
  if (range === "month") return new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);
  return `${+anchor.slice(0, 4) + n}-01-01`;
}

/** Calls grouped for the range: days (week), weeks (month), months (year). */
function callBars(m: Metrics, range: Range) {
  if (range === "week") {
    // all 7 days, future ones at 0
    const counts = new Map(m.calls.perDay.map((d) => [d.date, d.count]));
    return Array.from({ length: 7 }, (_, i) => addDays(m.from, i)).map((d) => ({ label: shortDow(d), value: counts.get(d) ?? 0 }));
  }
  const groups = new Map<string, number>();
  for (const d of m.calls.perDay) {
    const key = range === "month" ? `S${Math.floor((+d.date.slice(8) - 1) / 7) + 1}` : ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][+d.date.slice(5, 7) - 1] + d.date.slice(5, 7);
    groups.set(key, (groups.get(key) ?? 0) + d.count);
  }
  return [...groups].map(([k, v]) => ({ label: range === "year" ? k[0] : k, value: v }));
}

export function MetricsScreen() {
  const today = todayART();
  const [range, setRange] = useState<Range>("week");
  const [anchor, setAnchor] = useState(today);
  const { data: m, isLoading } = useMetrics(range, anchor);

  const period = m ? (range === "week" ? `${m.from.slice(8)}/${m.from.slice(5, 7)} – ${m.to.slice(8)}/${m.to.slice(5, 7)}` : range === "month" ? monthLabel(m.from) : m.from.slice(0, 4)) : "";
  const showed = m ? m.calls.total - m.calls.outcomes.unset - m.calls.outcomes.no_show - m.calls.outcomes.rescheduled : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Métricas" />
      <Segmented
        value={range}
        onChange={(r) => (setRange(r), setAnchor(today))}
        options={[
          { value: "week", label: "Semana" },
          { value: "month", label: "Mes" },
          { value: "year", label: "Año" },
        ]}
      />
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Período anterior" onClick={() => setAnchor(shiftAnchor(anchor, range, -1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_left" size={22} />
        </button>
        <span className="text-[15px] font-semibold text-text first-letter:uppercase">{period}</span>
        <button type="button" aria-label="Período siguiente" onClick={() => setAnchor(shiftAnchor(anchor, range, 1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_right" size={22} />
        </button>
      </div>

      {isLoading && !m && <TimelineSkeleton />}
      {m && m.blocks.total === 0 && <EmptyState icon="insights" title="Sin datos en este período" body="Las métricas salen de los días cargados y lo que vas marcando." />}

      {m && m.blocks.total > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard label="Bloques hechos" value={pct(m.blocks.doneRate)} note={`${m.blocks.done} de ${m.blocks.total}`} />
            <StatCard label="Llamadas cerradas" value={`${m.calls.outcomes.closed_won} / ${Math.max(showed, 0)}`} note={`cierre ${pct(m.calls.closeRate)}`} />
            <StatCard label="Se presentaron" value={pct(m.calls.showUpRate)} note={`${m.calls.outcomes.no_show} no se presentaron`} />
            <StatCard label="Gym" value={String(m.gym.total)} note={m.gym.weeks.length === 1 && m.gym.weeks[0].target ? `meta ${m.gym.weeks[0].target} por semana` : "sesiones"} />
          </div>

          <ChartCard title="Llamadas" period={range === "week" ? "por día" : range === "month" ? "por semana" : "por mes"} reading={`${m.calls.total} llamadas en el período.`}>
            <BarChart bars={callBars(m, range)} />
          </ChartCard>

          {m.gym.weeks.length > 0 && (
            <ChartCard title="Gym por semana" period={m.gym.weeks[0].target ? `meta ${m.gym.weeks[0].target}` : ""} reading={m.gym.weeks.map((w) => `${w.weekStart}: ${w.count}`).join(", ")}>
              <BarChart color={typeColor("gym")} bars={m.gym.weeks.map((w) => ({ label: w.weekStart.slice(8), value: w.count }))} />
            </ChartCard>
          )}

          <ChartCard title="Resultado de llamadas" period={`${m.calls.total} llamadas`} reading={Object.entries(m.calls.outcomes).map(([k, v]) => `${k} ${v}`).join(", ")}>
            <div className="flex flex-col gap-2">
              {(Object.keys(OUTCOME_LABEL) as Array<keyof typeof OUTCOME_LABEL>).map((k) => (
                <Bar key={k} label={OUTCOME_LABEL[k]} value={m.calls.outcomes[k]} max={Math.max(1, m.calls.total)} color="var(--call)" />
              ))}
              <Bar label="Sin resultado" value={m.calls.outcomes.unset} max={Math.max(1, m.calls.total)} color="var(--muted)" />
            </div>
          </ChartCard>

          <ChartCard title="Hecho por tipo" period={pct(m.blocks.doneRate)} reading={m.blocks.byType.map((t) => `${t.type} ${pct(t.doneRate)}`).join(", ")}>
            <div className="flex flex-col gap-2">
              {m.blocks.byType.map((t) => (
                <Bar key={t.type} label={BLOCK_TYPES[t.type].label} value={t.done} max={t.total} color={typeColor(t.type)} suffix={`${t.done}/${t.total}`} />
              ))}
            </div>
          </ChartCard>

          <div className="grid grid-cols-2 gap-2.5">
            <StatCard label="Días de lectura" value={`${m.reading.days}`} note={`de ${m.reading.totalDays}`} />
            <StatCard label="Dormiste" value={m.sleep.avgDurationMinutes === null ? "—" : duration(m.sleep.avgDurationMinutes)} note={m.sleep.avgBedtime ? `te acostás ${m.sleep.avgBedtime.startsWith("2") && +m.sleep.avgBedtime.slice(0, 2) >= 24 ? `${String(+m.sleep.avgBedtime.slice(0, 2) - 24).padStart(2, "0")}${m.sleep.avgBedtime.slice(2)}` : m.sleep.avgBedtime}` : "sin datos"} />
          </div>

          {m.habits.length > 0 && (
            <ChartCard title="Rachas" period="hábitos" reading={m.habits.map((h) => `${h.name}: ${h.currentStreak}`).join(", ")}>
              <div className="flex flex-col gap-2.5">
                {m.habits.map((h) => (
                  <div key={h.slug} className="flex items-center justify-between gap-2">
                    <span className="text-body-sm text-text">{h.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-caption text-muted">
                        {h.periodsMet}/{h.periodsTotal} · mejor {h.bestStreak}
                      </span>
                      <StreakChip count={h.currentStreak} unit="" />
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}

function Bar({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr_44px] items-center gap-2 text-caption">
      <span className="truncate text-text2">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-surface2">
        <span className="block h-full rounded-full" style={{ width: `${(value / Math.max(1, max)) * 100}%`, background: color }} />
      </span>
      <span className="text-right font-mono text-muted">{suffix ?? value}</span>
    </div>
  );
}

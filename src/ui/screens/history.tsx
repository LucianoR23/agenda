"use client";

import { useState } from "react";
import { useDay, useDays } from "@/client/queries";
import type { DaySummary } from "@/client/types";
import { cx } from "../cx";
import { BlockCard } from "../components/block-card";
import { Icon } from "../components/icon";
import { BottomSheet } from "../components/overlay";
import { PageTitle } from "../components/page";
import { HeatCell, StatCard, TimelineSkeleton } from "../components/surfaces";
import { addDays, dayLabel, monthLabel, todayART } from "../time";

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => addDays(`${new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1)).toISOString().slice(0, 10)}`, -1);
export const shiftMonth = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);

export function HistoryScreen() {
  const today = todayART();
  const [month, setMonth] = useState(monthStart(today));
  const [open, setOpen] = useState<string | null>(null);
  const from = month;
  const to = monthEnd(month);
  const days = useDays(from, to).data?.days ?? [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const lead = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const dates: Array<string | null> = [...Array(lead).fill(null)];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const withData = days.filter((d) => d.completion !== null);
  const avg = withData.length ? Math.round((withData.reduce((s, d) => s + (d.completion ?? 0), 0) / withData.length) * 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Historial" />
      <div className="flex h-14 items-center justify-between rounded-lg bg-surface px-1.5">
        <button type="button" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_left" size={22} />
        </button>
        <span className="text-[15px] font-semibold text-text first-letter:uppercase">{monthLabel(month)}</span>
        <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_right" size={22} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 rounded-xl bg-surface p-3" data-testid="heatmap">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <span key={i} className="pb-1 text-center font-mono text-[10px] text-muted">
            {d}
          </span>
        ))}
        {dates.map((d, i) =>
          d === null ? (
            <span key={`x${i}`} />
          ) : (
            <button key={d} type="button" onClick={() => byDate.has(d) && setOpen(d)} className={cx("rounded-[5px] outline-offset-2", d === today && "outline outline-1 outline-accent")} aria-label={label(d, byDate.get(d))}>
              <HeatCell value={byDate.get(d)?.completion ?? null} label="">
                {Number(d.slice(8))}
              </HeatCell>
            </button>
          ),
        )}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-micro text-muted">
        0%
        {[0.15, 0.4, 0.65, 1].map((o) => (
          <span key={o} className="size-3 rounded-[3px] bg-accent" style={{ opacity: o }} />
        ))}
        100%
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Promedio del mes" value={avg === null ? "—" : `${avg}%`} note={`${withData.length} días con plan`} />
        <StatCard label="Llamadas" value={String(days.reduce((s, d) => s + d.callsTotal, 0))} note="en el mes" />
      </div>

      <BottomSheet open={!!open} onClose={() => setOpen(null)} label="Día">
        {open && <DayDetail date={open} />}
      </BottomSheet>
    </div>
  );
}

const label = (d: string, s?: DaySummary) => (s ? `${dayLabel(d)}: ${Math.round((s.completion ?? 0) * 100)}% hecho` : `${dayLabel(d)}: sin plan`);

/** Read-only timeline + review of a past day. */
function DayDetail({ date }: { date: string }) {
  const { data: day } = useDay(date);
  if (!day) return <TimelineSkeleton />;
  const opt = day.options.find((o) => o.id === day.chosenOptionId) ?? day.options[0];
  return (
    <div className="flex flex-col gap-3" data-testid="day-detail">
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted">{day.status === "closed" ? "Cerrado" : "Abierto"} · opción {opt?.label}</span>
        <h2 className="text-title text-text">{dayLabel(date)}</h2>
      </div>
      {day.review && (
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Energía" value={`${day.review.energy}/5`} />
          <StatCard label="Ánimo" value={`${day.review.mood}/5`} />
          {day.review.text && <p className="col-span-2 rounded-lg bg-surface p-3.5 text-body-sm text-text2">{day.review.text}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {opt?.blocks.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
    </div>
  );
}

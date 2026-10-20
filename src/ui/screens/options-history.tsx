"use client";

import { useState } from "react";
import { useDay, useDays } from "@/client/queries";
import type { PlanOption } from "@/client/types";
import { typeColor } from "../block-types";
import { cx } from "../cx";
import { StatCard, TimelineSkeleton } from "../components/surfaces";
import { Icon } from "../components/icon";
import { BottomSheet } from "../components/overlay";
import { PageTitle } from "../components/page";
import { blockRange, STATUS_LABEL } from "../format";
import { dayLabel, monthLabel, todayART } from "../time";
import { monthEnd, monthStart, shiftMonth } from "./history";

/** Chosen vs not-chosen options per day: the alternatives Agenbot offered stay in the DB after I pick one. */
export function OptionsHistoryScreen() {
  const today = todayART();
  const [month, setMonth] = useState(monthStart(today));
  const [open, setOpen] = useState<string | null>(null);
  const days = (useDays(month, monthEnd(month)).data?.days ?? []).filter((d) => d.chosenOption);
  const tally = new Map<string, number>();
  for (const d of days) tally.set(d.chosenOption!, (tally.get(d.chosenOption!) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Opciones del día" back="/ajustes" subtitle="Qué opción elegiste cada día y qué te proponía la otra. Las no elegidas quedan guardadas tal cual las armó Agenbot." />
      <div className="flex h-14 items-center justify-between rounded-lg bg-surface px-1.5">
        <button type="button" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_left" size={22} />
        </button>
        <span className="text-[15px] font-semibold text-text first-letter:uppercase">{monthLabel(month)}</span>
        <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))} className="flex size-11 items-center justify-center text-muted">
          <Icon name="chevron_right" size={22} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {[...tally.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, n]) => (
            <StatCard key={label} label={`Elegiste ${label}`} value={String(n)} note={`${Math.round((n / days.length) * 100)}% de los días`} />
          ))}
      </div>

      {days.length === 0 ? (
        <p className="px-1 text-body-sm text-muted">No hay días con opción elegida este mes.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg bg-surface" data-testid="options-days">
          {[...days].reverse().map((d) => (
            <li key={d.date}>
              <button type="button" onClick={() => setOpen(d.date)} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft font-mono text-[15px] font-semibold text-accent">{d.chosenOption}</span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] text-text first-letter:uppercase">{dayLabel(d.date, today)}</span>
                  <span className="text-caption text-muted">
                    {d.completion === null ? "Sin bloques" : `${Math.round(d.completion * 100)}% hecho`}
                    {d.status === "edited" ? " · editado" : d.status === "closed" ? " · cerrado" : ""}
                  </span>
                </span>
                <Icon name="chevron_right" className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={!!open} onClose={() => setOpen(null)} label="Opciones">
        {open && <OptionsCompare date={open} />}
      </BottomSheet>
    </div>
  );
}

const key = (b: PlanOption["blocks"][number]) => b.title.trim().toLowerCase();

/** Every option of the day, the chosen one first, with what only one side had. */
function OptionsCompare({ date }: { date: string }) {
  const { data: day } = useDay(date);
  if (!day) return <TimelineSkeleton />;
  const chosen = day.options.find((o) => o.id === day.chosenOptionId);
  const others = day.options.filter((o) => o.id !== day.chosenOptionId);
  // calendar events are copied into every option, so they never make a difference
  const titles = (o: PlanOption) => new Set(o.blocks.filter((b) => b.source !== "calendar").map(key));
  return (
    <div className="flex flex-col gap-4" data-testid="options-compare">
      <div className="flex flex-col gap-1">
        <span className="text-caption text-muted">
          {day.options.length} {day.options.length === 1 ? "opción" : "opciones"} · elegiste {day.chosenOption ?? "—"}
        </span>
        <h2 className="text-title text-text first-letter:uppercase">{dayLabel(date)}</h2>
      </div>
      {!others.length && <p className="text-body-sm text-text2">Este día tuvo una sola opción.</p>}
      {chosen &&
        others.map((o) => {
          const mine = titles(chosen);
          const theirs = titles(o);
          const onlyMine = chosen.blocks.filter((b) => b.source !== "calendar" && !theirs.has(key(b)));
          const onlyTheirs = o.blocks.filter((b) => b.source !== "calendar" && !mine.has(key(b)));
          if (!onlyMine.length && !onlyTheirs.length) return null;
          return (
            <div key={o.id} className="flex flex-col gap-1.5 rounded-lg bg-surface p-3.5 text-body-sm">
              <span className="font-semibold text-text">
                {chosen.label} vs {o.label}
              </span>
              {onlyMine.length > 0 && <span className="text-text2">Solo en {chosen.label}: {onlyMine.map((b) => b.title).join(", ")}</span>}
              {onlyTheirs.length > 0 && <span className="text-text2">Solo en {o.label}: {onlyTheirs.map((b) => b.title).join(", ")}</span>}
            </div>
          );
        })}
      {[chosen, ...others].filter((o) => !!o).map((o) => (
        <OptionColumn key={o.id} option={o} chosen={o.id === day.chosenOptionId} edited={day.status === "edited" || day.status === "closed"} />
      ))}
    </div>
  );
}

function OptionColumn({ option, chosen, edited }: { option: PlanOption; chosen: boolean; edited: boolean }) {
  return (
    <section className={cx("flex flex-col gap-2 rounded-xl p-3.5", chosen ? "border border-accent bg-accent-soft" : "bg-surface")}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[15px] font-semibold text-text">{option.label}</span>
        <span className="flex-1 truncate text-[15px] text-text">{option.title}</span>
        <span className={cx("text-caption", chosen ? "text-accent" : "text-muted")}>{chosen ? (edited ? "Elegida · con tus cambios" : "Elegida") : "No elegida"}</span>
      </div>
      {option.description && <p className="text-body-sm text-text2">{option.description}</p>}
      <ul className="flex flex-col gap-1">
        {option.blocks.map((b) => (
          <li key={b.id} className={cx("flex items-center gap-2 text-body-sm", b.status === "skipped" && "text-muted line-through")}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: typeColor(b.type) }} />
            <span className="w-24 shrink-0 font-mono text-mono text-muted">{blockRange(b.start, b.end)}</span>
            <span className="flex-1 truncate text-text">{b.title}</span>
            {chosen && b.status !== "pending" && <span className="text-caption text-muted">{STATUS_LABEL[b.status]}</span>}
          </li>
        ))}
        {!option.blocks.length && <li className="text-body-sm text-muted">Sin bloques</li>}
      </ul>
    </section>
  );
}

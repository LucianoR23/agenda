"use client";

import { useState } from "react";
import { cx } from "../cx";
import { FilterChip } from "./controls";
import { Icon } from "./icon";

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DOW = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * Sistema Calma date picker: shortcuts (hoy, mañana, próximo lunes, sin fecha) + a month grid that starts on Monday.
 * Theme tokens only; keyboard reachable (each day is a button with a full Spanish label).
 */
export function DatePicker({
  value,
  onChange,
  today,
  allowNone = true,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  /** The user's local date (YYYY-MM-DD). */
  today: string;
  allowNone?: boolean;
}) {
  const base = Temporal.PlainDate.from(value ?? today);
  const [month, setMonth] = useState(() => base.toPlainYearMonth());
  const t = Temporal.PlainDate.from(today);
  const nextMonday = t.add({ days: (1 - t.dayOfWeek + 7) % 7 || 7 }).toString();

  const first = month.toPlainDate({ day: 1 });
  const blanks = first.dayOfWeek - 1;
  const days = Array.from({ length: month.daysInMonth }, (_, i) => first.add({ days: i }));

  const shortcuts: Array<{ label: string; date: string | null }> = [
    { label: "Hoy", date: today },
    { label: "Mañana", date: t.add({ days: 1 }).toString() },
    { label: "Próximo lunes", date: nextMonday },
    ...(allowNone ? [{ label: "Sin fecha", date: null }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {shortcuts.map((s) => (
          <FilterChip key={s.label} selected={value === s.date} onClick={() => onChange(s.date)}>
            {s.label}
          </FilterChip>
        ))}
      </div>
      <div className="rounded-lg bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setMonth((m) => m.subtract({ months: 1 }))}
            className="flex size-10 items-center justify-center rounded-md text-text2"
          >
            <Icon name="chevron_left" />
          </button>
          <span className="text-body text-text capitalize">
            {MONTHS[month.month - 1]} {month.year}
          </span>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setMonth((m) => m.add({ months: 1 }))}
            className="flex size-10 items-center justify-center rounded-md text-text2"
          >
            <Icon name="chevron_right" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {DOW.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday header (M repeats)
            <span key={i} className="py-1 text-caption text-muted" aria-hidden>
              {d}
            </span>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: empty leading cells
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const iso = d.toString();
            const selected = iso === value;
            const isToday = iso === today;
            return (
              <button
                key={iso}
                type="button"
                aria-label={`${d.day} de ${MONTHS[d.month - 1]} de ${d.year}`}
                aria-pressed={selected}
                onClick={() => onChange(iso)}
                className={cx(
                  "flex h-10 items-center justify-center rounded-md text-body-sm",
                  selected ? "bg-accent font-semibold text-on-accent" : isToday ? "border border-accent text-text" : "text-text",
                  iso < today && !selected && "text-muted",
                )}
              >
                {d.day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 15, 30, 45];
const pad = (n: number) => String(n).padStart(2, "0");

/** Sistema Calma time picker: hour grid + quarter-hour minutes + "sin hora". */
export function TimePicker({ value, onChange }: { value: string | null; onChange: (time: string | null) => void }) {
  const [h, m] = value ? value.split(":").map(Number) : [null, 0];
  const minute = m ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-6 gap-1.5">
        <legend className="sr-only">Hora</legend>
        {HOURS.map((hour) => (
          <button
            key={hour}
            type="button"
            aria-pressed={h === hour}
            onClick={() => onChange(`${pad(hour)}:${pad(minute)}`)}
            className={cx(
              "h-10 rounded-md font-mono text-body-sm",
              h === hour ? "bg-accent font-semibold text-on-accent" : "bg-surface text-text",
            )}
          >
            {pad(hour)}
          </button>
        ))}
      </fieldset>
      <div className="flex items-center gap-2">
        <fieldset className="grid flex-1 grid-cols-4 gap-1.5">
          <legend className="sr-only">Minutos</legend>
          {MINUTES.map((min) => (
            <button
              key={min}
              type="button"
              disabled={h === null}
              aria-pressed={h !== null && minute === min}
              onClick={() => h !== null && onChange(`${pad(h)}:${pad(min)}`)}
              className={cx(
                "h-10 rounded-md font-mono text-body-sm disabled:opacity-40",
                h !== null && minute === min ? "bg-accent font-semibold text-on-accent" : "bg-surface text-text",
              )}
            >
              :{pad(min)}
            </button>
          ))}
        </fieldset>
        <FilterChip selected={value === null} onClick={() => onChange(null)}>
          Sin hora
        </FilterChip>
      </div>
    </div>
  );
}

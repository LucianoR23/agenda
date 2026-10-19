"use client";

import { cx } from "../cx";
import type { IconName } from "../icons";
import { Icon } from "./icon";

export const TABS: Array<{ key: string; label: string; icon: IconName; href: string }> = [
  { key: "today", label: "Hoy", icon: "today", href: "/" },
  { key: "tasks", label: "Tareas", icon: "checklist", href: "/tareas" },
  { key: "history", label: "Historial", icon: "calendar_month", href: "/historial" },
  { key: "metrics", label: "Métricas", icon: "insights", href: "/metricas" },
  { key: "settings", label: "Ajustes", icon: "settings", href: "/ajustes" },
];

/**
 * Bottom tab bar (72 px). Up to 5 sections all visible; with 6+ the 5th becomes "Más" (sheet with the rest).
 * Desktop uses a sidebar with all sections.
 */
export function TabBar({ active }: { active: string }) {
  return (
    <nav aria-label="Secciones" className="grid h-[72px] grid-cols-5 border-t border-border bg-surface pb-safe">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <a key={t.key} href={t.href} aria-current={on ? "page" : undefined} className={cx("flex flex-col items-center justify-center gap-0.5", on ? "text-text" : "text-muted")}>
            <span className={cx("flex h-[30px] w-14 items-center justify-center rounded-[15px]", on && "bg-raised")}>
              <Icon name={t.icon} size={22} />
            </span>
            <span className="text-micro">{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** Day header: chevrons + swipe between days, with the position pill. */
export function DayHeader({ label, onPrev, onNext }: { label: string; onPrev?: () => void; onNext?: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between rounded-lg bg-surface px-1.5 text-text">
      <button type="button" aria-label="Día anterior" onClick={onPrev} className="flex size-11 items-center justify-center text-muted">
        <Icon name="chevron_left" size={22} />
      </button>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[15px] font-semibold">{label}</span>
        <div className="flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-[3px] bg-border2" />
          <span className="h-1.5 w-4 rounded-[3px] bg-text" />
          <span className="h-1.5 w-1.5 rounded-[3px] bg-border2" />
        </div>
      </div>
      <button type="button" aria-label="Día siguiente" onClick={onNext} className="flex size-11 items-center justify-center text-muted">
        <Icon name="chevron_right" size={22} />
      </button>
    </div>
  );
}

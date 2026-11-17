"use client";

import Link from "next/link";
import { useState } from "react";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { BrandMark } from "./brand";
import { Icon } from "./icon";
import { BottomSheet } from "./overlay";
import { RowGroup, SettingsRow } from "./surfaces";

export const TABS: Array<{ key: string; label: string; icon: IconName; href: string }> = [
  { key: "today", label: "Hoy", icon: "today", href: "/" },
  { key: "inbox", label: "Inbox", icon: "inbox", href: "/inbox" },
  { key: "tasks", label: "Tareas", icon: "checklist", href: "/tareas" },
  { key: "calendar", label: "Calendario", icon: "calendar_month", href: "/calendario" },
  { key: "reminders", label: "Recordatorios", icon: "notifications", href: "/recordatorios" },
  { key: "habits", label: "Hábitos", icon: "local_fire_department", href: "/habitos" },
  // Historial y métricas: one screen with two tabs (/metricas redirects to it)
  { key: "history", label: "Historial", icon: "insights", href: "/historial" },
  { key: "settings", label: "Ajustes", icon: "settings", href: "/ajustes" },
];

export type Badges = Partial<Record<string, number>>;

/** Small count on a tab icon (e.g. Inbox: tasks waiting to be sorted). */
function Badge({ n }: { n?: number | undefined }) {
  if (!n) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold text-bg"
    >
      {n}
    </span>
  );
}
const withBadge = (label: string, n?: number) => (n ? `${label}, ${n} ${n === 1 ? "pendiente" : "pendientes"}` : undefined);

/** Active tab from the pathname. */
export const tabFor = (pathname: string) =>
  TABS.find((t) => (t.href === "/" ? pathname === "/" : pathname.startsWith(t.href)))?.key ?? "today";

/** Tabs shown in the bottom bar; the rest live under "Más". */
const PRIMARY = 4;

function TabLink({ t, on, badge }: { t: (typeof TABS)[number]; on: boolean; badge?: number | undefined }) {
  return (
    <Link
      href={t.href}
      aria-current={on ? "page" : undefined}
      aria-label={withBadge(t.label, badge)}
      className={cx("flex flex-col items-center justify-center gap-0.5", on ? "text-text" : "text-muted")}
    >
      <span className={cx("flex h-[30px] w-14 items-center justify-center rounded-[15px] transition-colors", on && "bg-raised")}>
        <span className="relative">
          <Icon name={t.icon} size={22} />
          <Badge n={badge} />
        </span>
      </span>
      <span className="text-micro">{t.label}</span>
    </Link>
  );
}

/**
 * Bottom tab bar (72 px): the first four sections, then "Más" (a sheet with the rest). Desktop uses the sidebar with
 * every section.
 */
export function TabBar({ active, badges = {} }: { active: string; badges?: Badges }) {
  const [more, setMore] = useState(false);
  const rest = TABS.slice(PRIMARY);
  const moreActive = rest.some((t) => t.key === active);
  return (
    <>
      <nav
        aria-label="Secciones"
        className="grid h-[calc(72px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-border bg-surface pb-safe"
      >
        {TABS.slice(0, PRIMARY).map((t) => (
          <TabLink key={t.key} t={t} on={t.key === active} badge={badges[t.key]} />
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
          className={cx("flex flex-col items-center justify-center gap-0.5", moreActive ? "text-text" : "text-muted")}
        >
          <span className={cx("flex h-[30px] w-14 items-center justify-center rounded-[15px]", moreActive && "bg-raised")}>
            <Icon name="more_horiz" size={22} />
          </span>
          <span className="text-micro">Más</span>
        </button>
      </nav>
      <BottomSheet open={more} onClose={() => setMore(false)} label="Más secciones">
        <RowGroup>
          {rest.map((t) => (
            <SettingsRow key={t.key} icon={t.icon} title={t.label} href={t.href} onClick={() => setMore(false)} />
          ))}
        </RowGroup>
      </BottomSheet>
    </>
  );
}

export function Sidebar({ active, badges = {} }: { active: string; badges?: Badges }) {
  return (
    <nav aria-label="Secciones" className="flex w-60 flex-col gap-1 border-r border-border bg-surface p-4">
      <span className="flex items-center gap-2.5 px-3 pb-4">
        <BrandMark />
        <span className="text-[18px] font-semibold tracking-[-.01em] text-text">Agenda</span>
      </span>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            aria-label={withBadge(t.label, badges[t.key])}
            className={cx(
              "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px]",
              on ? "bg-raised font-semibold text-text" : "text-text2",
            )}
          >
            <span className="relative flex">
              <Icon name={t.icon} size={22} />
              <Badge n={badges[t.key]} />
            </span>
            {t.label}
          </Link>
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

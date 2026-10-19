"use client";

import type { ReactNode } from "react";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { Icon } from "./icon";

/** Bottom sheet surface: grabber, 28 px top radius, surface2, shadow. Positioning/animation is up to the caller. */
export function Sheet({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="dialog" aria-label={label} className="flex flex-col gap-3.5 rounded-t-[28px] bg-surface2 px-5 pt-2.5 pb-5 shadow-calma pb-safe">
      <div className="h-1 w-9 self-center rounded-sm bg-border2" />
      {children}
    </div>
  );
}

/** Grouped rows inside a sheet or settings page. */
export function RowGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col overflow-hidden rounded-lg bg-surface [&>*+*]:border-t [&>*+*]:border-border">{children}</div>;
}

export function SheetRow({
  icon,
  label,
  value,
  valueTone = "text",
  chevron,
  trailing,
  placeholder,
  onClick,
}: {
  icon: IconName;
  label: string;
  value?: string;
  valueTone?: "text" | "call" | "muted";
  chevron?: boolean;
  trailing?: ReactNode;
  placeholder?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 px-3.5"
    >
      <Icon name={icon} className="text-muted" />
      <span className={cx("flex-1 text-[15px]", placeholder ? "text-muted" : "text-text")}>{label}</span>
      {value && <span className={cx("text-[15px]", valueTone === "call" ? "text-call" : valueTone === "muted" ? "text-muted" : "text-text")}>{value}</span>}
      {trailing}
      {chevron && <Icon name="chevron_right" className="text-muted" />}
    </div>
  );
}

/** Settings row (64 px) with icon tile and subtitle. */
export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  onClick,
  href,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex size-9 items-center justify-center rounded-[10px] bg-surface2 text-text2">
        <Icon name={icon} />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] text-text">{title}</span>
        {subtitle && <span className="text-caption text-muted">{subtitle}</span>}
      </span>
      {value && <span className="text-body-sm text-muted">{value}</span>}
      <Icon name="chevron_right" className="text-muted" />
    </>
  );
  const cls = "flex min-h-16 items-center gap-3 px-3.5 text-left";
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Section card for "Hoy" widgets; a new module is the slot content. */
export function SectionCard({
  icon,
  iconColor,
  title,
  action,
  onAction,
  children,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <Icon name={icon} color={iconColor} />
        <h2 className="flex-1 text-[15px] font-semibold text-text">{title}</h2>
        {action && (
          <button type="button" onClick={onAction} className="flex min-h-11 items-center text-body-sm text-accent">
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Plan option card for the draft carousel (340 px; the next one peeks 24 px). */
export function OptionCard({
  label,
  title,
  description,
  segments,
  summary,
  selected,
}: {
  label: string;
  title: string;
  description?: string | null;
  segments: Array<{ color: string; weight: number }>;
  summary: string;
  selected?: boolean;
}) {
  return (
    <article
      className={cx(
        "flex w-[min(340px,calc(100vw-56px))] shrink-0 snap-start flex-col gap-3 rounded-xl border bg-surface p-[18px]",
        selected ? "border-accent" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("font-mono text-mono", selected ? "text-accent" : "text-muted")}>OPCIÓN {label}</span>
        {selected && <Icon name="radio_button_checked" className="text-accent" />}
      </div>
      <h2 className="text-title text-text">{title}</h2>
      {description && <p className="text-body-sm text-text2">{description}</p>}
      <div className="flex h-2 gap-1 overflow-hidden rounded" aria-hidden>
        {segments.map((s, i) => (
          <span key={i} style={{ flex: s.weight, background: s.color }} />
        ))}
      </div>
      <p className="text-caption text-muted">{summary}</p>
    </article>
  );
}

export function EmptyState({ icon, title, body, actions }: { icon: IconName; title: string; body: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl bg-surface px-5 py-7 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface2 text-muted">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="text-headline text-text">{title}</h2>
      <p className="max-w-[300px] text-body-sm text-text2">{body}</p>
      {actions && <div className="flex gap-2 pt-1.5">{actions}</div>}
    </div>
  );
}

export function TimelineSkeleton({ heights = [64, 86, 64] }: { heights?: number[] }) {
  return (
    <div className="flex flex-col gap-2" aria-busy aria-label="Cargando">
      {heights.map((h, i) => (
        <div key={i} className="grid grid-cols-[50px_1fr] gap-3">
          <div className="mt-4 h-2.5 w-9 justify-self-end rounded-[5px] bg-surface2" />
          <div className="flex flex-col gap-2 rounded-lg bg-surface p-3.5" style={{ height: h }}>
            <div className="h-3 w-3/5 rounded-md bg-surface2" />
            <div className="h-2.5 w-[35%] rounded-[5px] bg-surface2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stat card: label, big value, delta/period line. */
export function StatCard({ label, value, note, noteTone = "muted" }: { label: string; value: string; note?: string; noteTone?: "muted" | "success" | "danger" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface p-3.5">
      <span className="text-caption text-muted">{label}</span>
      <span className="text-[30px] font-semibold tracking-[-.02em] text-text">{value}</span>
      {note && <span className={cx("text-mono", noteTone === "success" ? "text-success" : noteTone === "danger" ? "text-danger" : "text-muted")}>{note}</span>}
    </div>
  );
}

/** Chart card pattern: title, period, chart, text reading (for screen readers too). */
export function ChartCard({ title, period, reading, children }: { title: string; period: string; reading: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2.5 rounded-lg bg-surface p-3.5">
      <figcaption className="flex justify-between text-caption">
        <span className="text-text">{title}</span>
        <span className="text-muted">{period}</span>
      </figcaption>
      <div aria-hidden>{children}</div>
      <p className="sr-only">{reading}</p>
    </figure>
  );
}

export function BarChart({ bars, color = "var(--call)", highlight }: { bars: Array<{ label: string; value: number }>; color?: string; highlight?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex h-[84px] items-end gap-2.5">
      {bars.map((b, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t-md rounded-b-sm"
            style={{ height: Math.max(4, (b.value / max) * 70), background: color, opacity: highlight === undefined || highlight === i ? 1 : 0.55 }}
          />
          <span className="font-mono text-[10px] text-muted">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const pts = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * 300},${62 - ((v - min) / (max - min || 1)) * 54}`)
    .join(" ");
  return (
    <svg viewBox="0 0 300 70" className="h-[70px] w-full">
      <polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Heatmap cell: completion 0 → 1 as accent opacity. */
export function HeatCell({ value, label, children }: { value: number | null; label: string; children?: ReactNode }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-[5px] bg-surface2" aria-label={label}>
      {value !== null && <div className="size-full bg-accent" style={{ opacity: value }} />}
      {children && <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-text">{children}</span>}
    </div>
  );
}

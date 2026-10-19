"use client";

import type { ComponentProps, ReactNode } from "react";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { Icon } from "./icon";

type ButtonVariant = "primary" | "secondary" | "accent" | "call" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-inverse text-on-inverse font-semibold",
  secondary: "border border-border2 text-text font-medium",
  accent: "bg-accent text-on-accent font-semibold",
  call: "bg-call text-on-call font-semibold",
  danger: "border border-danger text-danger font-semibold",
  ghost: "text-accent font-medium",
};

/** 44 px default; `size="lg"` = 52 px sticky/primary actions. Renders <a> when `href` is set. */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  href,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: IconName;
  href?: string;
} & ComponentProps<"button">) {
  const cls = cx(
    "inline-flex items-center justify-center gap-1.5 transition-[transform,opacity] active:scale-[.98] disabled:opacity-50",
    size === "lg" ? "h-[52px] rounded-[14px] px-5 text-body" : "h-11 rounded-md px-4 text-body-sm",
    variant !== "ghost" && size === "md" && "text-[15px]",
    BUTTON[variant],
    className,
  );
  const content = (
    <>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </>
  );
  if (href)
    return (
      <a href={href} className={cls} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {content}
      </a>
    );
  return (
    <button type="button" className={cls} {...rest}>
      {content}
    </button>
  );
}

/** Filter chip (36 px). */
export function FilterChip({ selected, children, ...rest }: { selected?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-medium",
        selected ? "bg-inverse text-on-inverse" : "border border-border2 text-text font-normal",
      )}
      {...rest}
    >
      {selected && <Icon name="check" size={16} />}
      {children}
    </button>
  );
}

type Tone = "neutral" | "muted" | "success" | "call" | "accent" | "danger";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface2 text-text2",
  muted: "bg-surface2 text-muted",
  success: "bg-success-soft text-success",
  call: "bg-call-soft text-call font-medium",
  accent: "bg-accent-soft text-accent font-medium",
  danger: "bg-danger-soft text-danger",
};

/** Status chip (28 px): icon + text, never color alone. */
export function StatusChip({
  tone = "neutral",
  icon,
  strike,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  strike?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx("inline-flex h-7 items-center gap-[5px] rounded-full px-2.5 text-caption", TONE[tone], strike && "line-through")}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  background = "bg-surface2",
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange?: (v: T) => void;
  className?: string;
  background?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cx("grid h-11 rounded-[14px] p-1", background, className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange?.(o.value)}
            className={cx(
              "flex items-center justify-center gap-1 rounded-[10px] text-body-sm transition-colors",
              on ? "bg-raised font-semibold text-text" : "text-muted",
            )}
          >
            {on && o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange?: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={cx(
        "flex h-8 w-[52px] shrink-0 rounded-full transition-colors duration-instant",
        checked ? "justify-end bg-accent p-[3px]" : "border border-border2 bg-surface2 p-0.5",
      )}
    >
      <span className={cx("size-[26px] rounded-full", checked ? "bg-on-accent" : "bg-muted")} />
    </button>
  );
}

/** Progress ring, e.g. weekly gym 2/3. */
export function Ring({ value, total, size = 64, label }: { value: number; total: number; size?: number; label?: string }) {
  const pct = total ? Math.min(1, value / total) * 100 : 0;
  return (
    <div
      role="img"
      aria-label={label ?? `${value} de ${total}`}
      className="flex items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(var(--accent) 0 ${pct}%, var(--surface2) ${pct}% 100%)` }}
    >
      <div
        className="flex items-center justify-center rounded-full bg-bg font-mono text-[14px] text-text"
        style={{ width: size - 12, height: size - 12 }}
      >
        {value}/{total}
      </div>
    </div>
  );
}

export function StreakChip({ count, unit = "días" }: { count: number; unit?: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-[5px] rounded-full bg-call-soft px-3 text-body-sm font-semibold text-call">
      <Icon name="local_fire_department" size={18} />
      {count} {unit}
    </span>
  );
}

export function Fab({ label, ...rest }: { label: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-14 items-center justify-center rounded-[18px] bg-inverse text-on-inverse shadow-calma active:scale-95"
      {...rest}
    >
      <Icon name="add" size={26} />
    </button>
  );
}

/** Carousel position dots (active = 16 px pill). */
export function PageDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex justify-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cx("h-1.5 rounded-[3px]", i === active ? "w-4 bg-text" : "w-1.5 bg-border2")} />
      ))}
    </div>
  );
}

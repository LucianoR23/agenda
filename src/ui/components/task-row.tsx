"use client";

import { animate, motion, type PanInfo, useMotionValue, useTransform } from "motion/react";
import { type ReactNode, useRef } from "react";
import type { Task } from "@/client/types";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { haptic } from "../time";
import { Icon } from "./icon";

const THRESHOLD = 96;

/**
 * Swipe right / left with the action revealed underneath (icon + text, never color alone). Ported from v1's timeline
 * gesture: direction-locked so vertical scroll still works, a haptic tick when crossing the threshold, and a swipe
 * never also counts as a tap.
 */
export function SwipeRow({
  right,
  left,
  onRight,
  onLeft,
  disabled,
  children,
}: {
  right: { icon: IconName; label: string; tone: "success" | "neutral" };
  left: { icon: IconName; label: string; tone: "success" | "neutral" };
  onRight: () => void;
  onLeft: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const x = useMotionValue(0);
  const rightOpacity = useTransform(x, [0, 24, THRESHOLD], [0, 0.6, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, -24, 0], [1, 0.6, 0]);
  const crossed = useRef<0 | 1 | -1>(0);
  const dragged = useRef(false);
  const tone = (t: "success" | "neutral") => (t === "success" ? "bg-success text-on-success" : "bg-raised text-text");

  return (
    <div className="relative">
      {!disabled && (
        <>
          <motion.div
            style={{ opacity: rightOpacity }}
            className={cx("absolute inset-0 flex items-center rounded-lg pl-4", tone(right.tone))}
          >
            <span className="flex items-center gap-1.5 text-body-sm font-semibold">
              <Icon name={right.icon} /> {right.label}
            </span>
          </motion.div>
          <motion.div
            style={{ opacity: leftOpacity }}
            className={cx("absolute inset-0 flex items-center justify-end rounded-lg pr-4", tone(left.tone))}
          >
            <span className="flex items-center gap-1.5 text-body-sm font-semibold">
              <Icon name={left.icon} /> {left.label}
            </span>
          </motion.div>
        </>
      )}
      <motion.div
        style={{ x }}
        drag={disabled ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDrag={(_: unknown, info: PanInfo) => {
          const zone = info.offset.x > THRESHOLD ? 1 : info.offset.x < -THRESHOLD ? -1 : 0;
          if (zone !== crossed.current) {
            if (zone !== 0) haptic(15);
            crossed.current = zone;
          }
        }}
        onDragEnd={(_: unknown, info: PanInfo) => {
          crossed.current = 0;
          if (info.offset.x > THRESHOLD) onRight();
          else if (info.offset.x < -THRESHOLD) onLeft();
          void animate(x, 0, { duration: 0.2 });
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
        onClickCapture={(e) => {
          if (dragged.current) e.stopPropagation();
        }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}

const PRIORITY: Record<number, { label: string; className: string } | undefined> = {
  3: { label: "Prioridad alta", className: "text-danger" },
  2: { label: "Prioridad media", className: "text-accent" },
  1: { label: "Prioridad baja", className: "text-muted" },
};

const shortDate = (iso: string, today: string) => {
  const d = Temporal.PlainDate.from(iso);
  const days = Temporal.PlainDate.from(today).until(d).days;
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Ayer";
  return `${d.day}/${d.month}`;
};

/** One task: check button, title, then time/date · list · tags · repeat · priority. */
export function TaskRow({
  task,
  today,
  listName,
  showDate = true,
  onToggle,
  onOpen,
  trailing,
}: {
  task: Task;
  today: string;
  listName?: string | undefined;
  showDate?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  trailing?: ReactNode;
}) {
  const done = task.status === "done";
  const prio = PRIORITY[task.priority];
  const when = [showDate && task.dueDate ? shortDate(task.dueDate, today) : null, task.dueTime].filter(Boolean).join(" ");
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg bg-surface px-3.5 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
        className="-m-1.5 flex size-11 shrink-0 items-center justify-center"
      >
        <Icon name={done ? "check_circle" : "radio_button_unchecked"} size={24} className={done ? "text-success" : "text-muted"} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className={cx("w-full truncate text-[15px]", done ? "text-muted line-through" : "text-text")}>{task.title}</span>
        {(when || listName || task.tags.length > 0 || task.rrule || prio) && (
          <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
            {when && <span className={cx(task.overdue && "font-semibold text-danger")}>{when}</span>}
            {task.rrule && <Icon name="repeat" size={14} label="Se repite" />}
            {listName && <span>{listName}</span>}
            {task.tags.map((t) => (
              <span key={t}>+{t}</span>
            ))}
            {prio && <Icon name="flag" size={14} className={prio.className} label={prio.label} />}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

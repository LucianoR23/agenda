"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { uuidv7 } from "uuidv7";
import { api } from "@/client/api";
import { useHabits, useTasks, useWrites } from "@/client/queries";
import type { HabitProgress, Task } from "@/client/types";
import { typeColor } from "../block-types";
import { cx } from "../cx";
import { Button, FilterChip, Ring, StreakChip } from "../components/controls";
import { Icon } from "../components/icon";
import { useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { DayHeader } from "../components/navigation";
import { EmptyState, RowGroup } from "../components/surfaces";
import type { IconName } from "../icons";
import { addDays, dayLabel, haptic, todayART } from "../time";

const KIND: Record<Task["kind"], { label: string; icon: IconName }> = {
  whatsapp_confirm: { label: "Confirmar por WhatsApp", icon: "chat" },
  lead_context: { label: "Contexto de leads", icon: "person" },
  follow_up: { label: "Seguimientos", icon: "update" },
  other: { label: "Otras", icon: "checklist" },
};

export function TasksScreen() {
  const today = todayART();
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<"all" | "tasks" | "habits">("all");
  const tasks = useTasks(date).data?.tasks ?? [];
  const habits = (useHabits().data?.habits ?? []).filter((h) => h.active);
  const writes = useWrites(date);
  const [title, setTitle] = useState("");

  const add = () => {
    if (!title.trim()) return;
    void writes.send("POST", "/api/tasks", { id: uuidv7(), date, title: title.trim(), kind: "other" }, "Tarea nueva", [JSON.stringify(["tasks", date])]);
    setTitle("");
  };

  const groups = (Object.keys(KIND) as Task["kind"][]).map((k) => ({ kind: k, items: tasks.filter((t) => t.kind === k) })).filter((g) => g.items.length);
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Tareas y hábitos" subtitle={tasks.length ? `${done} de ${tasks.length} tareas hechas` : undefined} />
      <DayHeader label={dayLabel(date, today)} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} />
      <div className="flex flex-wrap gap-2">
        <FilterChip selected={filter === "all"} onClick={() => setFilter("all")}>
          Todo
        </FilterChip>
        <FilterChip selected={filter === "tasks"} onClick={() => setFilter("tasks")}>
          Tareas
        </FilterChip>
        <FilterChip selected={filter === "habits"} onClick={() => setFilter("habits")}>
          Hábitos
        </FilterChip>
      </div>

      {filter !== "habits" && (
        <>
          {groups.map((g) => (
            <section key={g.kind} className="flex flex-col gap-2">
              <SectionLabel>{KIND[g.kind].label}</SectionLabel>
              <RowGroup>
                {g.items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => (haptic(10), void writes.patchTask(t.id, { done: !t.done }))}
                    className="flex min-h-14 items-center gap-3 px-3.5 text-left"
                    aria-pressed={t.done}
                  >
                    <Icon name={t.done ? "check_circle" : "radio_button_unchecked"} className={t.done ? "text-success" : "text-muted"} />
                    <span className={cx("flex-1 text-[15px]", t.done ? "text-muted line-through" : "text-text")}>{t.title}</span>
                    {t.origin === "agent" && <Icon name="auto_awesome" size={14} className="text-muted" label="Agenbot" />}
                  </button>
                ))}
              </RowGroup>
            </section>
          ))}
          {!tasks.length && <EmptyState icon="checklist" title="Sin tareas" body="Agenbot carga el checklist del día a las 07:00; también podés sumar las tuyas." />}
          <div className="flex gap-2">
            <input
              aria-label="Nueva tarea"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Nueva tarea…"
              className="h-11 flex-1 rounded-md border border-border2 bg-surface px-3.5 text-[15px] text-text outline-none focus:border-accent"
            />
            <Button icon="add" onClick={add} disabled={!title.trim()} aria-label="Agregar tarea" />
          </div>
        </>
      )}

      {filter !== "tasks" && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Hábitos</SectionLabel>
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} date={date} />
          ))}
          {!habits.length && <EmptyState icon="local_fire_department" title="Sin hábitos" body="Creá tus hábitos en Ajustes → Hábitos (ej. gym 3 por semana, lectura 20 páginas por día)." />}
        </section>
      )}
    </div>
  );
}

function HabitRow({ habit: h, date }: { habit: HabitProgress; date: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(h.today?.value?.toString() ?? "");
  const log = async (body: { done: boolean; value?: number }) => {
    try {
      await api("POST", `/api/habits/${h.slug}/logs`, { date, ...body });
      await qc.invalidateQueries({ queryKey: ["habits"] });
      haptic(10);
    } catch {
      toast({ icon: "sync_problem", message: "No se pudo guardar el hábito." });
    }
  };
  const color = h.blockType ? typeColor(h.blockType) : "var(--accent)";
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-3.5">
      {h.targetPeriod === "week" ? (
        <Ring value={h.period.count} total={h.period.target} size={52} label={`${h.name} ${h.period.count} de ${h.period.target} esta semana`} />
      ) : (
        <span className="flex size-[52px] items-center justify-center rounded-full bg-surface2" style={{ color }}>
          <Icon name={h.period.met ? "check_circle" : "radio_button_unchecked"} size={26} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-text">{h.name}</span>
        <span className="text-caption text-muted">
          {h.targetPeriod === "week" ? `${h.period.count}/${h.targetCount} esta semana` : `Meta: ${h.targetCount}${h.unit ? ` ${h.unit}` : ""} por día`}
        </span>
      </div>
      {h.streak.current > 0 && <StreakChip count={h.streak.current} unit={h.streak.unit === "week" ? "sem" : "días"} />}
      {h.kind === "numeric" ? (
        <div className="flex items-center gap-1.5">
          <input
            aria-label={`${h.name} hoy`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-11 w-16 rounded-md border border-border2 bg-surface2 px-2 text-center font-mono text-body text-text outline-none focus:border-accent"
            placeholder="0"
          />
          <Button variant="secondary" icon="check" aria-label={`Guardar ${h.name}`} disabled={!value} onClick={() => void log({ done: Number(value) >= h.targetCount, value: Number(value) })} />
        </div>
      ) : (
        <Button variant={h.today?.done ? "secondary" : "primary"} icon={h.today?.done ? "undo" : "check"} aria-label={h.today?.done ? `Desmarcar ${h.name}` : `Marcar ${h.name}`} onClick={() => void log({ done: !h.today?.done })} />
      )}
    </div>
  );
}

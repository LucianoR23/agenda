"use client";

import { useState } from "react";
import { ApiProblem } from "@/client/api";
import { useDirect, useHabits } from "@/client/queries";
import type { BlockType, HabitProgress } from "@/client/types";
import { BLOCK_TYPES, typeColor } from "../block-types";
import { cx } from "../cx";
import { Button, Segmented, Toggle } from "../components/controls";
import { Icon } from "../components/icon";
import { BottomSheet } from "../components/overlay";
import { PageTitle } from "../components/page";
import { RowGroup, SheetRow } from "../components/surfaces";

const field = "h-12 w-full rounded-md border border-border2 bg-surface px-3.5 text-body text-text outline-none focus:border-accent";

interface Draft {
  name: string;
  slug: string;
  kind: "boolean" | "numeric";
  unit: string;
  targetCount: string;
  targetPeriod: "day" | "week";
  blockType: BlockType | null;
  active: boolean;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function HabitsSettingsScreen() {
  const habits = useHabits().data?.habits ?? [];
  const [edit, setEdit] = useState<HabitProgress | "new" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Hábitos" back="/ajustes" subtitle="Vincular un hábito a un tipo de bloque lo registra solo al marcar ese bloque como hecho." />
      <RowGroup>
        {habits.map((h) => (
          <button key={h.id} type="button" onClick={() => setEdit(h)} className="flex min-h-16 items-center gap-3 px-3.5 text-left">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-surface2" style={{ color: h.blockType ? typeColor(h.blockType) : undefined }}>
              <Icon name={h.blockType ? BLOCK_TYPES[h.blockType].icon : "local_fire_department"} />
            </span>
            <span className="flex flex-1 flex-col">
              <span className={cx("text-[15px]", h.active ? "text-text" : "text-muted line-through")}>{h.name}</span>
              <span className="text-caption text-muted">
                {h.targetCount}
                {h.unit ? ` ${h.unit}` : ""} por {h.targetPeriod === "day" ? "día" : "semana"}
                {h.blockType ? ` · bloque ${BLOCK_TYPES[h.blockType].label.toLowerCase()}` : ""}
              </span>
            </span>
            <Icon name="chevron_right" className="text-muted" />
          </button>
        ))}
      </RowGroup>
      <Button icon="add" variant="secondary" onClick={() => setEdit("new")}>
        Nuevo hábito
      </Button>
      <BottomSheet open={edit !== null} onClose={() => setEdit(null)} label="Hábito">
        {edit && <HabitForm key={edit === "new" ? "new" : edit.id} habit={edit === "new" ? null : edit} onDone={() => setEdit(null)} />}
      </BottomSheet>
    </div>
  );
}

function HabitForm({ habit, onDone }: { habit: HabitProgress | null; onDone: () => void }) {
  const direct = useDirect();
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState<Draft>(
    habit
      ? { name: habit.name, slug: habit.slug, kind: habit.kind, unit: habit.unit ?? "", targetCount: String(habit.targetCount), targetPeriod: habit.targetPeriod, blockType: habit.blockType, active: habit.active }
      : { name: "", slug: "", kind: "boolean", unit: "", targetCount: "1", targetPeriod: "day", blockType: null, active: true },
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const valid = d.name.trim() && Number(d.targetCount) >= 1;

  const save = async () => {
    try {
      const common = { name: d.name.trim(), unit: d.kind === "numeric" && d.unit ? d.unit : null, targetCount: Number(d.targetCount), targetPeriod: d.targetPeriod, blockType: d.blockType, active: d.active };
      if (habit) await direct("PATCH", `/api/habits/${habit.id}`, common, [["habits"]]);
      else await direct("POST", "/api/habits", { ...common, slug: d.slug || slugify(d.name), kind: d.kind }, [["habits"]]);
      onDone();
    } catch (e) {
      setError(e instanceof ApiProblem ? (e.problem.errors?.[0]?.message ?? e.problem.detail ?? e.problem.title) : "Error");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">{habit ? habit.name : "Nuevo hábito"}</h2>
      <input aria-label="Nombre" placeholder="Nombre (ej. Gym)" value={d.name} onChange={(e) => set("name", e.target.value)} className={field} />
      {!habit && (
        <Segmented
          value={d.kind}
          onChange={(v) => set("kind", v)}
          options={[
            { value: "boolean", label: "Sí / no" },
            { value: "numeric", label: "Con cantidad" },
          ]}
        />
      )}
      <div className="grid grid-cols-[1fr_1fr] gap-2.5">
        <input aria-label="Meta" inputMode="numeric" value={d.targetCount} onChange={(e) => set("targetCount", e.target.value)} className={cx(field, "font-mono")} />
        {d.kind === "numeric" ? <input aria-label="Unidad" placeholder="páginas" value={d.unit} onChange={(e) => set("unit", e.target.value)} className={field} /> : <span />}
      </div>
      <Segmented
        value={d.targetPeriod}
        onChange={(v) => set("targetPeriod", v)}
        options={[
          { value: "day", label: "Por día" },
          { value: "week", label: "Por semana" },
        ]}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted">Se registra al marcar como hecho un bloque de tipo…</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => set("blockType", null)} className={cx("h-9 rounded-full px-3 text-caption", d.blockType === null ? "bg-inverse text-on-inverse" : "border border-border2 text-text")}>
            Ninguno
          </button>
          {(Object.keys(BLOCK_TYPES) as BlockType[])
            .filter((k) => k !== "call" && k !== "other")
            .map((k) => (
              <button key={k} type="button" onClick={() => set("blockType", k)} className={cx("flex h-9 items-center gap-1.5 rounded-full px-3 text-caption", d.blockType === k ? "bg-inverse text-on-inverse" : "border border-border2 text-text")}>
                <Icon name={BLOCK_TYPES[k].icon} size={16} />
                {BLOCK_TYPES[k].label}
              </button>
            ))}
        </div>
      </div>
      {habit && (
        <RowGroup>
          <SheetRow icon="check_circle" label="Activo" trailing={<Toggle checked={d.active} onChange={(v) => set("active", v)} label="Activo" />} />
        </RowGroup>
      )}
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={!valid} onClick={() => void save()}>
        Guardar
      </Button>
    </div>
  );
}

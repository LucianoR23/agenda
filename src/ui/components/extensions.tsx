"use client";

/**
 * Components the design does not include yet, built only from Sistema Calma tokens and patterns
 * (section card, sheet rows, segmented, banners). See docs/design.md → "Extensiones".
 */
import type { z } from "zod";
import type { ProposalDiff } from "@/contract/planning";
import type { SleepLog } from "@/contract/sleep";
import { BLOCK_TYPES, typeColor } from "../block-types";
import { cx } from "../cx";
import { blockRange, duration, localHHmm, OUTCOME_LABEL } from "../format";
import type { IconName } from "../icons";
import { Button, Segmented } from "./controls";
import { Icon } from "./icon";
import { RowGroup, SectionCard } from "./surfaces";

type Sleep = z.infer<typeof SleepLog>;

/**
 * Sleep card on "Hoy". Night: quick buttons "Me voy a dormir" / "Me levanté".
 * Morning with an incomplete previous night: reminder state with "Cargar".
 */
export function SleepCard({
  previousNight,
  night,
  mode,
  onBed,
  onWake,
  onEdit,
}: {
  previousNight: Sleep | null;
  night: Sleep | null;
  mode: "morning" | "night";
  onBed?: () => void;
  onWake?: () => void;
  onEdit?: () => void;
}) {
  const prevIncomplete = !previousNight?.bedAt || !previousNight?.wokeAt;
  if (mode === "morning") {
    return (
      <SectionCard icon="bedtime" iconColor={typeColor("sleep")} title="Sueño de anoche" action={prevIncomplete ? undefined : "Editar"} onAction={onEdit}>
        {prevIncomplete ? (
          <div className="flex flex-col gap-3">
            <p className="text-body-sm text-text2">
              {previousNight?.bedAt
                ? `Te acostaste a las ${localHHmm(previousNight.bedAt)}. ¿A qué hora te levantaste?`
                : "¿A qué hora te dormiste y a qué hora te levantaste?"}
            </p>
            <div className="flex gap-2">
              {previousNight?.bedAt ? (
                <Button icon="wb_twilight" className="flex-1" onClick={onWake}>
                  Me levanté ahora
                </Button>
              ) : null}
              <Button variant={previousNight?.bedAt ? "secondary" : "primary"} icon="edit" className="flex-1" onClick={onEdit}>
                Cargar horarios
              </Button>
            </div>
          </div>
        ) : (
          <SleepSummary log={previousNight!} />
        )}
      </SectionCard>
    );
  }
  const inBed = !!night?.bedAt && !night.wokeAt;
  return (
    <SectionCard icon="bedtime" iconColor={typeColor("sleep")} title={inBed ? "Buenas noches" : "Antes de dormir"}>
      {inBed ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-text2">
            Te acostaste a las <span className="font-mono">{localHHmm(night!.bedAt!)}</span>
            {night!.bedDelayMinutes ? ` · ${night!.bedDelayMinutes > 0 ? `${night!.bedDelayMinutes} min tarde` : "a tiempo"}` : ""}.
          </p>
          <Button icon="wb_twilight" size="lg" onClick={onWake}>
            Me levanté
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button icon="dark_mode" size="lg" className="flex-1" onClick={onBed}>
            Me voy a dormir
          </Button>
          <Button variant="secondary" size="lg" icon="edit" onClick={onEdit} aria-label="Cargar a mano" />
        </div>
      )}
    </SectionCard>
  );
}

function SleepSummary({ log }: { log: Sleep }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {[
        { l: "Me dormí", v: log.bedAt ? localHHmm(log.bedAt) : "—" },
        { l: "Me levanté", v: log.wokeAt ? localHHmm(log.wokeAt) : "—" },
        { l: "Dormí", v: log.durationMinutes !== null ? duration(log.durationMinutes) : "—" },
      ].map((c) => (
        <div key={c.l} className="flex flex-col gap-0.5 rounded-md bg-surface2 py-2.5">
          <span className="font-mono text-[15px] text-text">{c.v}</span>
          <span className="text-micro text-muted">{c.l}</span>
        </div>
      ))}
      {log.bedDelayMinutes !== null && log.bedDelayMinutes > 0 && (
        <p className="col-span-3 text-left text-caption text-muted">
          {log.bedDelayMinutes} min más tarde que lo planeado ({log.plannedStart}).
        </p>
      )}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  start: "inicio",
  end: "fin",
  title: "título",
  type: "tipo",
  detail: "detalle",
  lead: "lead",
  order: "orden",
};

type Diff = z.infer<typeof ProposalDiff>;
type Ref = Diff["added"][number];

function DiffRow({ icon, tone, r, detail }: { icon: IconName; tone: string; r: Ref; detail: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-3.5">
      <Icon name={icon} className={tone} />
      <Icon name={BLOCK_TYPES[r.type].icon} color={typeColor(r.type)} size={18} />
      <span className="flex flex-1 flex-col">
        <span className="text-[15px] text-text">{r.title}</span>
        <span className="font-mono text-mono text-muted">{detail}</span>
      </span>
    </div>
  );
}

/** Proposal diff (added / removed / moved / kept / ignored because I edited it) + Aceptar / Rechazar. */
export function ProposalDiffView({ reason, diff, onAccept, onReject }: { reason: string | null; diff: Diff; onAccept?: () => void; onReject?: () => void }) {
  const count = diff.added.length + diff.removed.length + diff.moved.length + diff.changed.length;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-caption text-accent">
          <Icon name="auto_awesome" size={16} />
          Agenbot propone {count} {count === 1 ? "cambio" : "cambios"} · opción {diff.option}
        </span>
        {reason && <p className="text-body-sm text-text2">{reason}</p>}
      </div>
      <RowGroup>
        {diff.moved.map((m) => (
          <DiffRow key={`m${m.block.id}`} icon="swap_horiz" tone="text-accent" r={m.block} detail={`${blockRange(m.from.start, m.from.end)} → ${blockRange(m.to.start, m.to.end)}`} />
        ))}
        {diff.added.map((r, i) => (
          <DiffRow key={`a${i}`} icon="add" tone="text-success" r={r} detail={`Nuevo · ${blockRange(r.start, r.end)}`} />
        ))}
        {diff.removed.map((r) => (
          <DiffRow key={`r${r.id}`} icon="do_not_disturb_on" tone="text-danger" r={r} detail={`Se quita · ${blockRange(r.start, r.end)}`} />
        ))}
        {diff.changed.map((c) => (
          <DiffRow key={`c${c.block.id}`} icon="edit" tone="text-text2" r={c.block} detail={Object.keys(c.fields).map((f) => FIELD_LABEL[f] ?? f).join(", ")} />
        ))}
        {diff.keptRemovedFromCalendar.map((r) => (
          <DiffRow key={`k${r.id}`} icon="event_busy" tone="text-warning" r={r} detail="Ya no está en Calendar · se conserva (lo marcaste)" />
        ))}
        {diff.preservedOverrides.map((p) => (
          <DiffRow key={`p${p.block.id}`} icon="lock" tone="text-muted" r={p.block} detail={`Queda como lo dejaste (${p.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")})`} />
        ))}
      </RowGroup>
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onReject}>
          Rechazar
        </Button>
        <Button size="lg" className="flex-1" onClick={onAccept}>
          Aceptar
        </Button>
      </div>
    </div>
  );
}

/** "Me atrasé": +15 / +30 / +60 for my pending blocks from now. */
export function ShiftChooser({ value, onChange, onApply, fromTime, affected }: { value: 15 | 30 | 60; onChange?: (v: 15 | 30 | 60) => void; onApply?: () => void; fromTime: string; affected: number }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-caption text-muted">
          <Icon name="more_time" size={16} />
          Desde las <span className="font-mono">{fromTime}</span>
        </span>
        <h2 className="text-title text-text">Me atrasé</h2>
      </div>
      <Segmented
        background="bg-bg"
        value={String(value) as "15" | "30" | "60"}
        onChange={(v) => onChange?.(Number(v) as 15 | 30 | 60)}
        options={[
          { value: "15", label: "+15 min" },
          { value: "30", label: "+30 min" },
          { value: "60", label: "+60 min" },
        ]}
      />
      <p className="text-body-sm text-text2">
        Muevo {affected} bloques pendientes tuyos y de Agenbot. Los de Calendar y los de hora fija quedan donde están; si algo pasa la medianoche, lo verás como <span className="font-mono">(+1)</span>.
      </p>
      <Button size="lg" onClick={onApply}>
        Correr {value} min
      </Button>
    </div>
  );
}

/** Conflict sheet: my offline change vs the server version, never silently overwritten. */
export function ConflictCompare({ field, mine, server, onKeepMine, onKeepServer }: { field: string; mine: string; server: string; onKeepMine?: () => void; onKeepServer?: () => void }) {
  return (
    <div className="flex flex-col gap-3.5">
      <span className="flex items-center gap-2 text-caption text-danger">
        <Icon name="sync_problem" size={16} />
        Tu versión y la del servidor no coinciden
      </span>
      <h2 className="text-title text-text">{field}</h2>
      <div className="grid grid-cols-2 gap-2">
        {[
          { l: "Tu cambio", v: mine, on: true },
          { l: "En el servidor", v: server, on: false },
        ].map((c) => (
          <div key={c.l} className={cx("flex flex-col gap-1 rounded-lg border bg-surface p-3.5", c.on ? "border-accent" : "border-border")}>
            <span className="text-micro text-muted">{c.l}</span>
            <span className="text-body text-text">{c.v}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={onKeepServer}>
          Usar servidor
        </Button>
        <Button size="lg" className="flex-1" onClick={onKeepMine}>
          Mantener el mío
        </Button>
      </div>
    </div>
  );
}

/** "Cierre del día" card (from 22:00): energy, mood, note, pending blocks to resolve. */
export function DayReviewCard({ energy, mood, pending, onChange }: { energy: number | null; mood: number | null; pending: number; onChange?: (k: "energy" | "mood", v: number) => void }) {
  const scale = (k: "energy" | "mood", value: number | null, label: string) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-muted">{label}</span>
      <Segmented
        background="bg-bg"
        value={String(value ?? "")}
        onChange={(v) => onChange?.(k, Number(v))}
        options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
      />
    </div>
  );
  return (
    <SectionCard icon="dark_mode" title="Cierre del día">
      <div className="flex flex-col gap-3">
        {pending > 0 && (
          <p className="flex items-center gap-2 text-body-sm text-text2">
            <Icon name="radio_button_unchecked" size={16} className="text-muted" />
            {pending} bloques sin resolver: deslizalos a hecho o salteado.
          </p>
        )}
        {scale("energy", energy, "Energía")}
        {scale("mood", mood, "Ánimo")}
        <div className="flex min-h-14 items-center gap-3 rounded-lg bg-surface2 px-3.5 text-[15px] text-muted">
          <Icon name="notes" />
          ¿Algo para recordar de hoy?
        </div>
      </div>
    </SectionCard>
  );
}

/** Outcome picker rows for call blocks. */
export function OutcomePicker({ value, onChange }: { value: keyof typeof OUTCOME_LABEL | null; onChange?: (v: keyof typeof OUTCOME_LABEL) => void }) {
  return (
    <RowGroup>
      {(Object.keys(OUTCOME_LABEL) as Array<keyof typeof OUTCOME_LABEL>).map((k) => (
        <button key={k} type="button" onClick={() => onChange?.(k)} className="flex min-h-14 items-center gap-3 px-3.5 text-left">
          <Icon name={value === k ? "radio_button_checked" : "radio_button_unchecked"} className={value === k ? "text-call" : "text-muted"} />
          <span className="flex-1 text-[15px] text-text">{OUTCOME_LABEL[k]}</span>
        </button>
      ))}
    </RowGroup>
  );
}

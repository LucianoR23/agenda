"use client";

/**
 * Components the design does not include yet, built only from Sistema Calma tokens and patterns
 * (section card, sheet rows, segmented, banners). See docs/design.md → "Extensiones".
 */
import { cx } from "../cx";
import { Button, Segmented } from "./controls";
import { Icon } from "./icon";
import { SectionCard } from "./surfaces";

/** Conflict sheet: my offline change vs the server version, never silently overwritten. */
export function ConflictCompare({
  field,
  mine,
  server,
  onKeepMine,
  onKeepServer,
}: {
  field: string;
  mine: string;
  server: string;
  onKeepMine?: () => void;
  onKeepServer?: () => void;
}) {
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

/** "Cierre del día" card (from 22:00): energy, mood, note, pending items to resolve. */
export function DayReviewCard({
  energy,
  mood,
  pending,
  onChange,
}: {
  energy: number | null;
  mood: number | null;
  pending: number;
  onChange?: (k: "energy" | "mood", v: number) => void;
}) {
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
            {pending} pendientes sin resolver.
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

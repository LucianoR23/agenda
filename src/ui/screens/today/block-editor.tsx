"use client";

import { useState } from "react";
import { outcomeFits } from "@/contract/planning";
import type { Block, BlockType, CallKind, CallOutcome } from "@/client/types";
import { BLOCK_TYPES, typeColor } from "../../block-types";
import { cx } from "../../cx";
import { Button, Segmented, Toggle } from "../../components/controls";
import { OutcomePicker } from "../../components/extensions";
import { Icon } from "../../components/icon";
import { RowGroup, SheetRow } from "../../components/surfaces";
import { blockRange, CALL_KIND_LABEL, OUTCOME_LABEL, whatsappLink } from "../../format";

const TIME = /^([01][0-9]|2[0-9]):[0-5][0-9]$/;
const input = "h-12 w-full rounded-md border border-border2 bg-surface px-3.5 text-body text-text outline-none focus:border-accent";

export interface BlockDraft {
  start: string;
  end: string;
  title: string;
  type: BlockType;
  callKind: CallKind | null;
  detail: string;
  status: Block["status"];
  outcome: CallOutcome | null;
  note: string;
  locked: boolean;
  remind: boolean;
}

const fromBlock = (b: Block): BlockDraft => ({
  start: b.start,
  end: b.end ?? "",
  title: b.title,
  type: b.type,
  callKind: b.callKind,
  detail: b.detail ?? "",
  status: b.status,
  outcome: b.outcome,
  note: b.note ?? "",
  locked: b.locked,
  remind: b.remind,
});

const empty = (start: string): BlockDraft => ({ start, end: "", title: "", type: "other", callKind: null, detail: "", status: "pending", outcome: null, note: "", locked: false, remind: false });

/** Only the fields that changed, in API shape. */
export function patchFrom(b: Block, d: BlockDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  if (b.source !== "calendar") {
    if (d.start !== b.start) out.start = d.start;
    if (n(d.end) !== b.end) out.end = n(d.end);
    if (d.title.trim() !== b.title) out.title = d.title.trim();
    if (d.type !== b.type) out.type = d.type;
    const kind = d.type === "call" ? d.callKind : null;
    if (kind !== b.callKind && (d.type === "call" || b.type === "call")) out.callKind = kind;
    if (n(d.detail) !== b.detail) out.detail = n(d.detail);
  }
  if (d.status !== b.status) out.status = d.status;
  if (d.outcome !== b.outcome) out.outcome = d.outcome;
  if (n(d.note) !== b.note) out.note = n(d.note);
  if (d.locked !== b.locked) out.locked = d.locked;
  if (d.remind !== b.remind) out.remind = d.remind;
  return out;
}

export function BlockEditor({
  block,
  defaultStart,
  focusOutcome,
  onSave,
  onCreate,
  onDelete,
}: {
  block: Block | null;
  defaultStart: string;
  focusOutcome?: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onCreate: (d: BlockDraft) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<BlockDraft>(() => (block ? fromBlock(block) : empty(defaultStart)));
  const [pickOutcome, setPickOutcome] = useState(!!focusOutcome);
  const set = <K extends keyof BlockDraft>(k: K, v: BlockDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const calendar = block?.source === "calendar";
  const isCall = d.type === "call";
  const timesOk = TIME.test(d.start) && (d.end === "" || TIME.test(d.end));
  const valid = timesOk && d.title.trim().length > 0;
  const t = BLOCK_TYPES[d.type];

  return (
    <div className="flex flex-col gap-3.5" data-testid="block-editor">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-caption text-muted">
          <Icon name={t.icon} size={16} color={typeColor(d.type)} />
          {t.label}
          {isCall && d.callKind && ` · ${CALL_KIND_LABEL[d.callKind]}`}
          {block && ` · ${blockRange(block.start, block.end)}`}
          {calendar && (
            <>
              {" · "}
              <Icon name="event" size={14} /> Calendar
            </>
          )}
          {block?.source === "agent" && (
            <>
              {" · "}
              <Icon name="auto_awesome" size={14} /> Agenbot
            </>
          )}
        </span>
        <h2 className="text-title text-text">{block ? (block.lead?.name ?? block.title) : "Nuevo bloque"}</h2>
        {block?.lead?.notes && <p className="text-body-sm text-text2">{block.lead.notes}</p>}
      </div>

      {block && (
        <Segmented
          background="bg-bg"
          value={d.status}
          onChange={(v) => set("status", v)}
          options={[
            { value: "pending", label: "Pendiente" },
            { value: "done", label: "Hecho", icon: "check" },
            { value: "skipped", label: "Salteado" },
          ]}
        />
      )}

      {!calendar && (
        <div className="flex flex-col gap-2.5">
          <input aria-label="Título" placeholder="Título" value={d.title} onChange={(e) => set("title", e.target.value)} className={input} />
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-micro text-muted">
              Inicio
              <input aria-label="Inicio" inputMode="numeric" value={d.start} onChange={(e) => set("start", e.target.value)} className={cx(input, "font-mono", !TIME.test(d.start) && "border-danger")} placeholder="HH:mm" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-muted">
              Fin
              <input aria-label="Fin" inputMode="numeric" value={d.end} onChange={(e) => set("end", e.target.value)} className={cx(input, "font-mono", d.end !== "" && !TIME.test(d.end) && "border-danger")} placeholder="HH:mm" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo">
            {(Object.keys(BLOCK_TYPES) as BlockType[])
              .filter((k) => k !== "call" || d.type === "call")
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={d.type === k}
                  onClick={() => set("type", k)}
                  className={cx("flex h-9 items-center gap-1.5 rounded-full px-3 text-caption", d.type === k ? "bg-inverse text-on-inverse" : "border border-border2 text-text")}
                >
                  <Icon name={BLOCK_TYPES[k].icon} size={16} color={d.type === k ? undefined : typeColor(k)} />
                  {BLOCK_TYPES[k].label}
                </button>
              ))}
          </div>
          {isCall && (
            <Segmented
              background="bg-bg"
              value={d.callKind ?? "none"}
              onChange={(v) => {
                const kind = v === "none" ? null : (v as CallKind);
                // an outcome the new kind can't have is cleared (D93)
                setD((x) => ({ ...x, callKind: kind, outcome: outcomeFits(kind, x.outcome) ? x.outcome : null }));
              }}
              options={[
                { value: "closer", label: "Closer" },
                { value: "triage", label: "Triage" },
                { value: "none", label: "Sin tipo" },
              ]}
            />
          )}
          <textarea aria-label="Detalle" placeholder="Detalle (opcional)" value={d.detail} onChange={(e) => set("detail", e.target.value)} rows={2} className={cx(input, "h-auto py-3")} />
          <p className="text-caption text-muted">Hasta 29:59: 24:15 es 00:15 del día siguiente.</p>
        </div>
      )}

      <RowGroup>
        {isCall && block && <SheetRow icon="flag" label="Resultado" value={d.outcome ? OUTCOME_LABEL[d.outcome] : "Elegir"} valueTone={d.outcome ? "call" : "muted"} chevron onClick={() => setPickOutcome((v) => !v)} />}
        <div className="flex min-h-14 items-start gap-3 px-3.5 py-3">
          <Icon name="notes" className="mt-0.5 text-muted" />
          <textarea aria-label="Nota" placeholder="Agregá una nota…" value={d.note} onChange={(e) => set("note", e.target.value)} rows={d.note ? 3 : 1} className="flex-1 resize-none bg-transparent text-[15px] text-text outline-none placeholder:text-muted" />
        </div>
        <SheetRow icon="notifications" label="Avisarme 10 min antes" trailing={<Toggle checked={d.remind} onChange={(v) => set("remind", v)} label="Avisarme 10 min antes" />} />
        {!calendar && <SheetRow icon="lock" label="Hora fija (Agenbot no la mueve)" trailing={<Toggle checked={d.locked} onChange={(v) => set("locked", v)} label="Hora fija" />} />}
      </RowGroup>

      {pickOutcome && isCall && (
        <OutcomePicker
          value={d.outcome}
          kind={d.callKind}
          onChange={(o) => {
            setD((x) => ({ ...x, outcome: o, status: x.status === "pending" ? "done" : x.status }));
            setPickOutcome(false);
          }}
        />
      )}

      {isCall && block?.lead && block.status === "pending" && whatsappLink(block.lead) && (
        <Button variant="call" icon="chat" href={whatsappLink(block.lead)!}>
          WhatsApp
        </Button>
      )}

      {calendar && block?.externalUrl && (
        <Button variant="ghost" icon="open_in_new" className="justify-start px-0" href={block.externalUrl}>
          Editar en Google Calendar
        </Button>
      )}

      <Button size="lg" disabled={!block && !valid} onClick={() => (block ? onSave(patchFrom(block, d)) : onCreate(d))}>
        {block ? "Guardar" : "Agregar bloque"}
      </Button>
      {block && !calendar && (
        <Button variant="danger" onClick={onDelete}>
          Borrar bloque
        </Button>
      )}
    </div>
  );
}

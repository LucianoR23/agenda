"use client";

import { useState } from "react";
import type { Adjustment } from "@/client/types";
import { Button, StatusChip } from "../../components/controls";
import { Icon } from "../../components/icon";
import { SectionCard } from "../../components/surfaces";
import { cx } from "../../cx";
import { localHHmm } from "../../format";
import type { IconName } from "../../icons";
import { addDays } from "../../time";

type Tone = "neutral" | "muted" | "success" | "call" | "accent" | "danger";

/** What the request means for me now: the agent's status plus the linked proposal's. */
export function adjustmentState(a: Adjustment): { label: string; tone: Tone; icon: IconName; ready?: boolean } {
  if (a.status === "cancelled") return { label: "Cancelado", tone: "muted", icon: "close" };
  if (a.status === "failed") return { label: "No se pudo", tone: "danger", icon: "info" };
  switch (a.proposal?.status) {
    case "pending":
      return { label: "Propuesta lista", tone: "accent", icon: "auto_awesome", ready: true };
    case "accepted":
      return { label: "Aplicado", tone: "success", icon: "check_circle" };
    case "rejected":
      return { label: "Rechazaste la propuesta", tone: "muted", icon: "do_not_disturb_on" };
    case "superseded":
      return { label: "Reemplazada por una más nueva", tone: "muted", icon: "sync" };
  }
  if (a.status === "done") return { label: "Aplicado", tone: "success", icon: "check_circle" };
  return { label: "Esperando a Agenbot", tone: "neutral", icon: "schedule" };
}

export const readyCount = (list: Adjustment[] | undefined) => list?.filter((a) => adjustmentState(a).ready).length ?? 0;

/** "+" on Hoy: a new block, or a request to Agenbot. */
export function AddChooser({ canBlock, canAsk, onBlock, onAsk }: { canBlock: boolean; canAsk: boolean; onBlock: () => void; onAsk: () => void }) {
  const row = (icon: IconName, title: string, body: string, enabled: boolean, onClick: () => void) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className="flex min-h-16 items-center gap-3 rounded-lg bg-surface px-3.5 py-3 text-left disabled:opacity-50"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface2 text-text2">
        <Icon name={icon} />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-text">{title}</span>
        <span className="text-body-sm text-muted">{body}</span>
      </span>
      <Icon name="chevron_right" className="text-muted" />
    </button>
  );
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="text-title text-text">Agregar</h2>
      {row("add", "Nuevo evento", canBlock ? "Un bloque en tu día, con hora." : "Primero tiene que haber un plan para este día.", canBlock, onBlock)}
      {row("auto_awesome", "Pedido a Agenbot", canAsk ? "Contale qué cambió y te propone cómo reacomodar el día." : "El día está cerrado.", canAsk, onAsk)}
    </div>
  );
}

/** "Pedir ajuste": free text + the day it applies to (today or later). */
export function AdjustmentForm({ defaultDate, today, onSend }: { defaultDate: string; today: string; onSend: (date: string, text: string) => void }) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(defaultDate < today ? today : defaultDate);
  const quick = [
    [today, "Hoy"],
    [addDays(today, 1), "Mañana"],
  ] as const;
  const valid = text.trim().length > 0 && date >= today;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSend(date, text.trim());
      }}
    >
      <h2 className="text-title text-text">Pedido a Agenbot</h2>
      <p className="text-body-sm text-text2">Contale qué cambió. Te responde con una propuesta que aceptás o rechazás.</p>
      <textarea
        aria-label="Qué cambió"
        autoFocus
        value={text}
        maxLength={1000}
        rows={4}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Se movió Carlos a las 15:00\nSe canceló Pamela\nMe surgió algo de 14 a 16"}
        className="min-h-28 resize-none rounded-lg border border-border2 bg-surface px-3.5 py-3 text-[16px] leading-snug text-text outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-muted">Para</span>
        {quick.map(([d, label]) => (
          <button
            key={d}
            type="button"
            aria-pressed={date === d}
            onClick={() => setDate(d)}
            className={cx("h-9 rounded-full border px-3 text-body-sm", date === d ? "border-accent bg-accent-soft text-accent" : "border-border2 text-text")}
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          aria-label="Día"
          min={today}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-9 rounded-full border border-border2 bg-transparent px-3 text-body-sm text-text"
        />
      </div>
      <Button type="submit" size="lg" icon="auto_awesome" disabled={!valid}>
        Enviar a Agenbot
      </Button>
    </form>
  );
}

/** How long the latest request stays open after Agenbot answers; then it folds with the rest. */
const OPEN_AFTER_ANSWER_MS = 10 * 60_000;

/** My requests for the day, folded: tap one to see the agent's note and the way to the proposal. */
export function AdjustmentsCard({ items, now, onCancel, onOpenProposal }: { items: Adjustment[]; now: Date; onCancel: (a: Adjustment) => void; onOpenProposal: () => void }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!items.length) return null;
  // the latest one shows itself while it waits and for a while after the answer
  const latest = items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  const fresh = !latest.resolvedAt || now.getTime() - new Date(latest.resolvedAt).getTime() < OPEN_AFTER_ANSWER_MS;
  return (
    <SectionCard icon="auto_awesome" iconColor="var(--accent)" title="Pedidos a Agenbot">
      <ul className="flex flex-col divide-y divide-border" data-testid="adjustments">
        {items.map((a) => {
          const st = adjustmentState(a);
          const resolved = !!a.resolvedAt && !st.ready;
          const open = toggled[a.id] ?? (a.id === latest.id && fresh);
          return (
            <li key={a.id} className={cx("flex flex-col gap-2 py-3 first:pt-0 last:pb-0", resolved && !open && "opacity-70")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((t) => ({ ...t, [a.id]: !open }))}
                className="flex min-h-11 flex-col gap-1.5 text-left"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <StatusChip tone={st.tone} icon={st.icon}>
                    {st.label}
                  </StatusChip>
                  <span className="flex items-center gap-1 font-mono text-mono text-muted">
                    {localHHmm(a.createdAt)}
                    <Icon name="chevron_right" size={18} className={cx("transition-transform", open && "rotate-90")} />
                  </span>
                </span>
                <span className={cx("text-body text-text", !open && "truncate")}>{a.text}</span>
              </button>
              {open && a.agentNote && (
                <p className="flex gap-1.5 text-body-sm text-text2">
                  <Icon name="auto_awesome" size={16} className="mt-0.5 shrink-0 text-muted" />
                  {a.agentNote}
                </p>
              )}
              {open && (st.ready || a.status === "pending") && (
                <div className="flex gap-2">
                  {st.ready && <Button onClick={onOpenProposal}>Ver propuesta</Button>}
                  {a.status === "pending" && (
                    <Button variant="ghost" onClick={() => onCancel(a)}>
                      Cancelar pedido
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

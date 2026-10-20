"use client";

import type { z } from "zod";
import type { Block } from "@/contract/planning";
import { BLOCK_TYPES, typeColor } from "../block-types";
import { cx } from "../cx";
import { blockRange, blockTime, CALL_KIND_LABEL, OUTCOME_LABEL, STATUS_LABEL, whatsappLink } from "../format";
import type { IconName } from "../icons";
import { Button } from "./controls";
import { Icon } from "./icon";

export type BlockData = z.infer<typeof Block>;

const STATUS_ICON: Record<BlockData["status"], IconName> = {
  pending: "radio_button_unchecked",
  done: "check_circle",
  skipped: "do_not_disturb_on",
};

const SOURCE: Record<BlockData["source"], { label: string; icon: IconName }> = {
  calendar: { label: "Calendar", icon: "event" },
  agent: { label: "Agenbot", icon: "auto_awesome" },
  user: { label: "yo", icon: "person" },
};

/**
 * Timeline block (Sistema Calma · "Bloque de timeline · estados"):
 * hour · type icon · title · state (icon + text) · meta · source. The bottom slot takes future metadata
 * without changing the base height.
 */
export function BlockCard({ block, onOpen }: { block: BlockData; onOpen?: () => void }) {
  const type = BLOCK_TYPES[block.type];
  const isCall = block.type === "call";
  const done = block.status === "done";
  const skipped = block.status === "skipped";
  const removed = block.removedFromCalendarAt !== null;
  const fixedTime = block.source === "calendar" || block.locked;
  const editedByMe = block.source !== "user" && block.userOverrides.length > 0;
  const start = blockTime(block.start);
  const chat = block.lead ? whatsappLink(block.lead) : null;

  return (
    <div className={cx("grid grid-cols-[50px_1fr] gap-3", done && "opacity-55", skipped && "opacity-50")}>
      <div className="pt-4 text-right font-mono text-mono text-muted">
        {start.text}
        {start.nextDay && <span className="block text-[10px]">+1</span>}
      </div>
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen}
        className={cx(
          "flex flex-col gap-2 rounded-lg bg-surface px-3.5 py-3",
          "border",
          skipped || removed ? "border-dashed border-border2" : isCall && !done ? "border-call" : "border-border",
        )}
      >
        <div className="flex items-center gap-2.5">
          <Icon name={type.icon} color={typeColor(block.type)} />
          <div className={cx("flex-1 text-body text-text", (skipped || removed) && "line-through")}>
            {block.title}
            {isCall && block.callKind && <span className="ml-2 inline-flex h-6 items-center rounded-full bg-call-soft px-2 align-middle text-micro font-medium text-call">{CALL_KIND_LABEL[block.callKind]}</span>}
          </div>
          <Icon name={removed ? "event_busy" : STATUS_ICON[block.status]} className="text-muted" label={STATUS_LABEL[block.status]} />
        </div>

        {block.lead && <div className="text-title text-call">{block.lead.name}</div>}

        <div className="flex flex-wrap gap-2 text-caption text-muted">
          <span className="font-mono">{blockRange(block.start, block.end)}</span>
          {block.detail && <span>{block.detail}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-mono text-muted">
          <Icon name={SOURCE[block.source].icon} size={14} />
          {SOURCE[block.source].label}
          <span>· {STATUS_LABEL[block.status]}</span>
          {fixedTime && (
            <span className="flex items-center gap-[3px]">
              · <Icon name="lock" size={14} />
              hora fija
            </span>
          )}
          {editedByMe && (
            <span className="flex items-center gap-[3px] text-accent">
              · <Icon name="edit" size={14} />
              editado por vos
            </span>
          )}
          {removed && (
            <span className="flex items-center gap-[3px] text-warning">
              · <Icon name="event_busy" size={14} />
              Ya no está en Google Calendar
            </span>
          )}
        </div>

        {block.outcome && (
          <div className="flex">
            <span className="inline-flex h-7 items-center gap-[5px] rounded-full bg-call-soft px-2.5 text-caption font-medium text-call">
              <Icon name="update" size={15} />
              {OUTCOME_LABEL[block.outcome]}
            </span>
          </div>
        )}

        {isCall && block.status === "pending" && !removed && chat && (
          <div className="flex pt-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="call" icon="chat" className="flex-1" href={chat}>
              WhatsApp
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Now" line, updated every minute by the timeline. */
export function NowLine({ time }: { time: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Ahora, ${time}`}>
      <div className="w-[50px] text-right font-mono text-mono font-medium text-accent">{time}</div>
      <div className="size-2 rounded-full bg-accent" />
      <div className="h-px flex-1 bg-accent" />
    </div>
  );
}

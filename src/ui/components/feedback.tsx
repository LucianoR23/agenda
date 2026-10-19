"use client";

import type { ReactNode } from "react";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { Icon } from "./icon";

type BannerKind = "info" | "proposal" | "offline" | "conflict";

const BANNER: Record<BannerKind, { box: string; icon: IconName; iconColor: string }> = {
  info: { box: "bg-surface", icon: "info", iconColor: "text-text2" },
  proposal: { box: "bg-accent-soft border border-accent", icon: "auto_awesome", iconColor: "text-accent" },
  offline: { box: "bg-surface2", icon: "cloud_off", iconColor: "text-warning" },
  conflict: { box: "bg-danger-soft border border-danger", icon: "sync_problem", iconColor: "text-danger" },
};

/** Banners: info · Agenbot proposal · offline · version conflict. */
export function Banner({
  kind,
  title,
  children,
  action,
  onAction,
}: {
  kind: BannerKind;
  title?: string;
  children?: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  const b = BANNER[kind];
  return (
    <div role={kind === "conflict" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg p-3.5 text-text", action ? "items-center" : "items-start", b.box)}>
      <Icon name={b.icon} className={b.iconColor} />
      <div className="flex-1 text-body-sm">
        {title && <b className="font-semibold">{title}</b>}
        {title && children && <br />}
        {children}
      </div>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className={cx(
            "h-11 rounded-md px-3.5 text-body-sm font-semibold",
            kind === "conflict" ? "border border-danger text-danger" : "bg-accent text-on-accent",
          )}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/** "Sincronizando… · última vez 15:10" / offline indicator. */
export function SyncStatus({ state, lastSync }: { state: "syncing" | "idle" | "offline"; lastSync: string | null }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-mono text-muted" aria-live="polite">
      {state === "syncing" && <span className="size-3.5 animate-spin rounded-full border-2 border-border2 border-t-accent" />}
      {state === "offline" && <Icon name="cloud_off" size={14} className="text-warning" />}
      {state === "syncing" ? "Sincronizando…" : state === "offline" ? "Sin conexión" : "Sincronizado"}
      {lastSync && ` · última vez ${lastSync}`}
    </div>
  );
}

/** Undo toast (52 px, inverse). */
export function Toast({ icon = "check_circle", message, action, onAction }: { icon?: IconName; message: string; action?: string; onAction?: () => void }) {
  return (
    <div role="status" className="flex min-h-[52px] items-center gap-2.5 rounded-[14px] bg-inverse py-0 pr-1.5 pl-4 text-on-inverse shadow-calma">
      <Icon name={icon} />
      <span className="flex-1 text-body-sm">{message}</span>
      {action && (
        <button type="button" onClick={onAction} className="h-11 px-3 text-body-sm font-semibold text-accent-on-inverse">
          {action}
        </button>
      )}
    </div>
  );
}

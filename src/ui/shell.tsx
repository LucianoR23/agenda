"use client";

import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { onAuthProblem } from "@/client/api";
import { hydrateFromIdb, makeQueryClient, useAdjustments, useSession } from "@/client/queries";
import { onRejected, resolveConflict, startSync, useSync } from "@/client/sync";
import type { SessionState } from "@/client/types";
import { Banner } from "./components/feedback";
import { ConflictCompare } from "./components/extensions";
import { BottomSheet, ToastHost, useToast } from "./components/overlay";
import { Sidebar, TabBar, tabFor } from "./components/navigation";
import { TimelineSkeleton } from "./components/surfaces";
import { SetupScreen, UnlockScreen } from "./screens/auth";
import { readyCount } from "./screens/today/adjustments";
import { applyTheme, readTheme } from "./theme";
import { registerServiceWorker } from "./pwa";
import { todayART } from "./time";

/** Client root: query cache hydrated from IndexedDB, sync engine, auth gate, navigation. */
export function AppShell({ children }: { children: ReactNode }) {
  const [qc] = useState(makeQueryClient);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    applyTheme(readTheme());
    hydrateFromIdb(qc)
      .catch(() => {})
      .finally(() => setReady(true));
    const stop = startSync(qc);
    registerServiceWorker();
    return stop;
  }, [qc]);
  if (!ready) return <Splash />;
  return (
    <QueryClientProvider client={qc}>
      <ToastHost>
        <Gate>{children}</Gate>
      </ToastHost>
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div className="mx-auto w-full max-w-[560px] p-4 pt-20" aria-busy>
      <TimelineSkeleton />
    </div>
  );
}

const LAST_SESSION = "agenda:session";

function Gate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useSession();
  useEffect(() => onAuthProblem(() => void qc.invalidateQueries({ queryKey: ["session"] })), [qc]);

  let s: SessionState | undefined = session.data;
  if (s) {
    try {
      localStorage.setItem(LAST_SESSION, s.state);
    } catch {}
  } else if (session.error?.offline) {
    // offline start: trust the last known state so cached data stays usable
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_SESSION);
    } catch {}
    if (last === "unlocked") s = { state: "unlocked", passkeyEnabled: false, lockedUntil: null, device: null, vapidPublicKey: null };
  }

  if (!s) return <Splash />;
  if (s.state === "setup_required") return <SetupScreen />;
  if (s.state !== "unlocked") return <UnlockScreen session={s} />;
  return <Frame>{children}</Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = tabFor(pathname);
  const badges = { today: readyCount(useAdjustments(todayART()).data?.adjustments) };
  return (
    <div className="flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh md:flex">
        <Sidebar active={active} badges={badges} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-4 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[calc(96px+env(safe-area-inset-bottom))] md:max-w-[720px] md:pb-10">
          <SyncBanners />
          {children}
        </main>
        <div className="fixed inset-x-0 bottom-0 z-30 md:hidden">
          <TabBar active={active} badges={badges} />
        </div>
      </div>
      <Conflicts />
    </div>
  );
}

/** Offline banner + toast when the server rejects a queued change. */
function SyncBanners() {
  const sync = useSync();
  const toast = useToast();
  useEffect(() => onRejected((item, reason) => toast({ icon: "sync_problem", message: `No se pudo guardar: ${reason}` })), [toast]);
  if (sync.online) return null;
  return (
    <Banner kind="offline">
      Sin conexión. Guardamos tus cambios{sync.pending ? ` (${sync.pending})` : ""} y los subimos cuando vuelvas.
    </Banner>
  );
}

const FIELD: Record<string, string> = { start: "Inicio", end: "Fin", status: "Estado", outcome: "Resultado", note: "Nota", title: "Título", done: "Hecho" };

/** Conflict sheet: never overwrite silently (mine vs server). */
function Conflicts() {
  const qc = useQueryClient();
  const { conflicts } = useSync();
  const c = conflicts[0];
  if (!c) return null;
  const body = (c.body ?? {}) as Record<string, unknown>;
  const current = (c.conflict?.current ?? {}) as Record<string, unknown>;
  const field = Object.keys(body).find((k) => k !== "version" && k !== "force") ?? "";
  const why =
    c.conflict?.code === "version_conflict"
      ? "Cambió en el servidor mientras estabas sin conexión (Agenbot o otro dispositivo)."
      : c.conflict?.code === "calendar_owned"
        ? "Este horario lo maneja Google Calendar."
        : c.conflict?.code === "day_closed"
          ? "El día ya está cerrado."
          : "Lo cambió otra parte antes que vos.";
  const fmt = (v: unknown) => (v === null || v === undefined ? "—" : String(v));
  return (
    <BottomSheet open onClose={() => void resolveConflict(qc, c.id, "server")} label="Conflicto">
      <ConflictCompare
        field={`${typeof current.title === "string" ? current.title : c.label} · ${FIELD[field] ?? field}`}
        mine={fmt(body[field])}
        server={fmt(current[field])}
        onKeepMine={() => void resolveConflict(qc, c.id, "mine")}
        onKeepServer={() => void resolveConflict(qc, c.id, "server")}
      />
      <p className="text-caption text-muted">{why}</p>
    </BottomSheet>
  );
}

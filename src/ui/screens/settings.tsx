"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { useDirect, useSession, useWebhookStatus } from "@/client/queries";
import { Button, Segmented, Toggle } from "../components/controls";
import { Icon } from "../components/icon";
import { useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { RowGroup, SettingsRow, SheetRow } from "../components/surfaces";
import { localHHmm } from "../format";
import { canInstall, currentPushEndpoint, disablePush, enablePush, onInstallable, promptInstall, pushSupported } from "../pwa";
import { applyTheme, readTheme, type ThemePref } from "../theme";

const PREFS = "agenda:push-prefs";

export function SettingsScreen() {
  const session = useSession().data;
  const webhook = useWebhookStatus().data;
  const direct = useDirect();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [push, setPush] = useState(false);
  const [prefs, setPrefs] = useState<{ callReminders: boolean; sleepReminders: boolean }>(() => {
    try {
      const p = localStorage.getItem(PREFS);
      if (p) return JSON.parse(p);
    } catch {}
    return { callReminders: true, sleepReminders: true };
  });
  const [installable, setInstallable] = useState(canInstall);

  useEffect(() => {
    void currentPushEndpoint().then((e) => setPush(!!e));
    return onInstallable(() => setInstallable(true));
  }, []);

  const savePrefs = async (next: typeof prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {}
    if (push && session?.vapidPublicKey) await enablePush(session.vapidPublicKey, next).catch(() => {});
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) {
        if (!session?.vapidPublicKey) throw new Error("El servidor no tiene VAPID configurado.");
        await enablePush(session.vapidPublicKey, prefs);
      } else await disablePush();
      setPush(on);
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    }
  };

  const exportData = async () => {
    const r = await api<unknown>("GET", "/api/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `agenda-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const last = webhook?.lastDelivery;
  const webhookText = !webhook?.configured
    ? "Webhook sin configurar"
    : !last
      ? "Sin envíos todavía"
      : last.status === "sent"
        ? `Último envío ${last.sentAt ? localHHmm(last.sentAt) : ""} · OK`
        : last.status === "failed"
          ? `Falló: ${last.lastError ?? ""}`
          : `En cola (${last.attempts} intentos)`;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Ajustes" subtitle={session?.device ? `Este dispositivo: ${session.device.name}` : undefined} />
      {installable && <InstallCard onDone={() => setInstallable(false)} />}

      <SectionLabel>General</SectionLabel>
      <RowGroup>
        <SettingsRow icon="local_fire_department" title="Hábitos y metas" subtitle="Gym 3 por semana, lectura…" href="/ajustes/habitos" />
        <SettingsRow icon="swap_horiz" title="Opciones del día" subtitle="Elegidas vs no elegidas" href="/ajustes/opciones" />
        <SettingsRow icon="lock" title="Seguridad" subtitle="PIN, huella, dispositivos" href="/ajustes/seguridad" />
      </RowGroup>

      <SectionLabel>Apariencia</SectionLabel>
      <Segmented
        value={theme}
        onChange={(t) => (setTheme(t), applyTheme(t))}
        options={[
          { value: "system", label: "Sistema" },
          { value: "dark", label: "Oscuro" },
          { value: "light", label: "Claro" },
        ]}
      />

      <SectionLabel>Notificaciones</SectionLabel>
      <RowGroup>
        <SheetRow icon="notifications" label="Notificaciones en este dispositivo" trailing={<Toggle checked={push} onChange={(v) => void togglePush(v)} label="Notificaciones" />} />
        <SheetRow icon="call" label="Aviso 10 min antes de bloques" trailing={<Toggle checked={prefs.callReminders} onChange={(v) => void savePrefs({ ...prefs, callReminders: v })} label="Aviso antes de bloques" />} />
        <SheetRow icon="bedtime" label="Recordatorio de sueño (mañana)" trailing={<Toggle checked={prefs.sleepReminders} onChange={(v) => void savePrefs({ ...prefs, sleepReminders: v })} label="Recordatorio de sueño" />} />
      </RowGroup>
      {!pushSupported() && <p className="px-1 text-caption text-muted">Este navegador no soporta notificaciones push. Instalá la app desde Chrome.</p>}

      <SectionLabel>Agenbot</SectionLabel>
      <div className="flex flex-col gap-3 rounded-lg bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
            <Icon name="auto_awesome" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-[15px] text-text">Carga diaria a las 07:00</span>
            <span className={last?.status === "failed" ? "text-caption text-danger" : "text-caption text-muted"} data-testid="webhook-status">
              {webhookText}
              {webhook && webhook.queued > 0 ? ` · ${webhook.queued} en cola` : ""}
            </span>
          </span>
        </div>
        <details className="text-body-sm text-text2">
          <summary className="cursor-pointer text-accent">Rotar el token de Agenbot</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              En la terminal del contenedor: <code className="font-mono">pnpm agent:token</code>
            </li>
            <li>
              Copiá el hash a <code className="font-mono">AGENT_TOKEN_HASH</code> en Coolify y redeployá.
            </li>
            <li>Pasale el token nuevo a Agenbot. El anterior deja de funcionar al instante.</li>
          </ol>
        </details>
      </div>

      <SectionLabel>Datos</SectionLabel>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" icon="download" onClick={() => void exportData()}>
          Exportar todo (JSON)
        </Button>
        <Button variant="danger" onClick={() => void direct("POST", "/api/auth/logout", undefined, [["session"]])}>
          Cerrar sesión en este dispositivo
        </Button>
      </div>

      <SectionLabel>Acerca de</SectionLabel>
      <About />
    </div>
  );
}

function InstallCard({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface p-3.5">
      <Image src="/icons/icon-any.svg" width={44} height={44} alt="" unoptimized />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-text">Instalá Agenda</span>
        <span className="text-body-sm text-muted">Abrí tu día desde la pantalla de inicio, también sin conexión.</span>
      </div>
      <Button onClick={() => void promptInstall().then(onDone)}>Instalar</Button>
    </div>
  );
}

function About() {
  const toast = useToast();
  const version = useQuery({ queryKey: ["health"], queryFn: () => api<{ version: string }>("GET", "/api/health").then((r) => r.data.version), staleTime: Infinity }).data;
  const [installed] = useState(() => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches);

  const checkUpdate = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toast({ icon: "info", message: "Sin service worker en este navegador." });
    await reg.update().catch(() => {});
    const incoming = reg.installing ?? reg.waiting;
    if (!incoming) return toast({ icon: "check_circle", message: "Ya tenés la última versión." });
    toast({ icon: "sync", message: "Actualizando…" });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  };

  return (
    <RowGroup>
      <div className="flex min-h-16 items-center gap-3 px-3.5">
        <Image src="/icons/icon-any.svg" width={40} height={40} alt="" unoptimized />
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] text-text">Agenda</span>
          <span className="font-mono text-mono text-muted">
            {version ? `v ${version.slice(0, 7)}` : "…"} · {installed ? "instalada" : "en el navegador"}
          </span>
        </span>
      </div>
      <SheetRow icon="system_update" label="Buscar actualización" onClick={() => void checkUpdate()} />
    </RowGroup>
  );
}

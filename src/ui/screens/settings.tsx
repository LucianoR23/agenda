"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { useDirect, useSession } from "@/client/queries";
import { Button, Segmented, Toggle } from "../components/controls";
import { useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { RowGroup, SettingsRow, SheetRow } from "../components/surfaces";
import { canInstall, currentPushEndpoint, disablePush, enablePush, onInstallable, promptInstall, pushSupported } from "../pwa";
import { applyTheme, readTheme, type ThemePref } from "../theme";

export function SettingsScreen() {
  const session = useSession().data;
  const direct = useDirect();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [push, setPush] = useState(false);
  const [installable, setInstallable] = useState(canInstall);

  useEffect(() => {
    void currentPushEndpoint().then((e) => setPush(!!e));
    return onInstallable(() => setInstallable(true));
  }, []);

  const togglePush = async (on: boolean) => {
    try {
      if (on) {
        if (!session?.vapidPublicKey) throw new Error("El servidor no tiene VAPID configurado.");
        await enablePush(session.vapidPublicKey);
      } else await disablePush();
      setPush(on);
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Ajustes" subtitle={session?.device ? `Este dispositivo: ${session.device.name}` : undefined} />
      {installable && <InstallCard onDone={() => setInstallable(false)} />}

      <SectionLabel>General</SectionLabel>
      <RowGroup>
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
        <SheetRow
          icon="notifications"
          label="Notificaciones en este dispositivo"
          trailing={<Toggle checked={push} onChange={(v) => void togglePush(v)} label="Notificaciones" />}
        />
      </RowGroup>
      {!pushSupported() && (
        <p className="px-1 text-caption text-muted">Este navegador no soporta notificaciones push. Instalá la app desde Chrome.</p>
      )}

      <SectionLabel>Sesión</SectionLabel>
      <div className="flex flex-col gap-2">
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
  const version = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ version: string }>("GET", "/api/health").then((r) => r.data.version),
    staleTime: Infinity,
  }).data;
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

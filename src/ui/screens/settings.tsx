"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { useDirect, useSession, useSettings } from "@/client/queries";
import type { Settings } from "@/client/types";
import { Button, Segmented, TextField, Toggle } from "../components/controls";
import { TimePicker } from "../components/date-picker";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { RowGroup, SettingsRow, SheetRow } from "../components/surfaces";
import { canInstall, currentPushEndpoint, disablePush, enablePush, onInstallable, promptInstall, pushSupported } from "../pwa";
import { applyTheme, readTheme, type ThemePref } from "../theme";
import { userTimeZone } from "../time";

export function SettingsScreen() {
  const session = useSession().data;
  const direct = useDirect();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [push, setPush] = useState(false);
  const [installable, setInstallable] = useState(canInstall);
  const [tzOpen, setTzOpen] = useState(false);
  const tz = session?.timezone ?? userTimeZone();

  useEffect(() => {
    void currentPushEndpoint().then((e) => setPush(!!e));
    return onInstallable(() => setInstallable(true));
  }, []);

  const testPush = async () => {
    try {
      const r = await direct<{ ok: number; failed: number }>("POST", "/api/push/test", {});
      toast({
        icon: r.ok ? "check_circle" : "info",
        message: r.ok
          ? `Enviada a ${r.ok} ${r.ok === 1 ? "dispositivo" : "dispositivos"}`
          : "No llegó a ningún dispositivo. Revisá el permiso.",
      });
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    }
  };

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
        <SettingsRow icon="key" title="Tokens de API" subtitle="Acceso de Sunday a tu agenda" href="/ajustes/tokens" />
        <SettingsRow icon="public" title="Zona horaria" subtitle={tz.replaceAll("_", " ")} onClick={() => setTzOpen(true)} />
      </RowGroup>
      <BottomSheet open={tzOpen} onClose={() => setTzOpen(false)} label="Zona horaria">
        {tzOpen && <TimezonePicker current={tz} onDone={() => setTzOpen(false)} />}
      </BottomSheet>

      <SectionLabel>Apariencia</SectionLabel>
      <Segmented
        value={theme}
        onChange={(t) => {
          setTheme(t);
          applyTheme(t);
        }}
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
        {push && <SheetRow icon="notifications" label="Probar notificación" onClick={() => void testPush()} />}
      </RowGroup>
      {!pushSupported() && (
        <p className="px-1 text-caption text-muted">Este navegador no soporta notificaciones push. Instalá la app desde Chrome.</p>
      )}
      <NotificationSettings />

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
    if (reg.waiting) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      return toast({ icon: "sync", message: "Actualizando…" });
    }
    if (reg.installing) return toast({ icon: "sync", message: "Descargando la versión nueva…" });
    toast({ icon: "check_circle", message: "Ya tenés la última versión." });
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

/** Every IANA zone the browser knows, searchable ("madrid", "buenos aires"). Changing it re-dates everything. */
function TimezonePicker({ current, onDone }: { current: string; onDone: () => void }) {
  const direct = useDirect();
  const toast = useToast();
  const [q, setQ] = useState("");
  const zones = Intl.supportedValuesOf("timeZone");
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replaceAll("_", " ");
  const matches = zones.filter((z) => norm(z).includes(norm(q.trim()))).slice(0, 40);
  const choose = async (timezone: string) => {
    try {
      await direct("PATCH", "/api/settings", { timezone }, [["session"], ["settings"]]);
      toast({ icon: "check_circle", message: `Zona horaria: ${timezone.replaceAll("_", " ")}` });
      onDone();
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Zona horaria</h2>
      <p className="text-body-sm text-text2">Las fechas y horas de tareas, recordatorios y eventos usan esta zona.</p>
      <TextField label="Buscar zona" placeholder="Buscar (por ejemplo Madrid)" value={q} onChange={(e) => setQ(e.target.value)} />
      <RowGroup>
        {matches.map((z) => (
          <button key={z} type="button" onClick={() => void choose(z)} className="flex min-h-12 items-center gap-3 px-3.5 text-left">
            <span className="flex-1 text-[15px] text-text">{z.replaceAll("_", " ")}</span>
            {z === current && <Icon name="check" className="text-accent" />}
          </button>
        ))}
        {matches.length === 0 && <p className="px-3.5 py-3 text-body-sm text-muted">No encontré esa zona.</p>}
      </RowGroup>
    </div>
  );
}

/** Quiet hours, snooze length and when a late reminder counts as missed (all settings, saved right away). */
function NotificationSettings() {
  const settings = useSettings().data;
  const direct = useDirect();
  const toast = useToast();
  const [editing, setEditing] = useState<"start" | "end" | null>(null);
  if (!settings) return null;
  const save = (patch: Partial<Settings>) =>
    direct("PATCH", "/api/settings", patch, [["settings"]]).catch((e) => toast({ icon: "info", message: (e as Error).message }));
  const quietOn = settings.quietStart !== null;
  return (
    <>
      <RowGroup>
        <SheetRow
          icon="dark_mode"
          label="Horas de silencio"
          trailing={
            <Toggle
              checked={quietOn}
              onChange={(on) => void save(on ? { quietStart: "23:30", quietEnd: "07:00" } : { quietStart: null, quietEnd: null })}
              label="Horas de silencio"
            />
          }
        />
        {quietOn && (
          <>
            <SheetRow icon="bedtime" label="Desde" value={settings.quietStart ?? ""} chevron onClick={() => setEditing("start")} />
            <SheetRow icon="wb_twilight" label="Hasta" value={settings.quietEnd ?? ""} chevron onClick={() => setEditing("end")} />
          </>
        )}
      </RowGroup>
      <p className="px-1 text-caption text-muted">Los recordatorios no urgentes que caen en ese rato llegan cuando termina.</p>

      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-caption text-muted">Posponer</span>
        <Segmented
          value={String(settings.defaultSnoozeMinutes)}
          onChange={(v) => void save({ defaultSnoozeMinutes: Number(v) })}
          options={["5", "10", "15", "30"].map((m) => ({ value: m, label: `${m} min` }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="px-1 text-caption text-muted">
          Si el servidor estuvo caído, un recordatorio atrasado más de esto se marca como perdido
        </span>
        <Segmented
          value={String(settings.missedAfterHours)}
          onChange={(v) => void save({ missedAfterHours: Number(v) })}
          options={["6", "12", "24", "48"].map((h) => ({ value: h, label: `${h} h` }))}
        />
      </div>

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} label="Horas de silencio">
        {editing && (
          <div className="flex flex-col gap-3">
            <h2 className="text-title text-text">{editing === "start" ? "Silencio desde" : "Silencio hasta"}</h2>
            <TimePicker
              value={editing === "start" ? settings.quietStart : settings.quietEnd}
              onChange={(t) => {
                if (!t) return;
                void save(editing === "start" ? { quietStart: t } : { quietEnd: t });
              }}
            />
            <Button size="lg" onClick={() => setEditing(null)}>
              Listo
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

"use client";

import { useState } from "react";
import { useCalendars, useDirect } from "@/client/queries";
import type { CalendarSource, CalendarStatus } from "@/client/types";
import { Button, Segmented, TextField, Toggle } from "../components/controls";
import { Banner } from "../components/feedback";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { RowGroup, SheetRow, TimelineSkeleton } from "../components/surfaces";
import { ago } from "../time";

/** What `?google=…` after the OAuth round trip means. */
const RESULT: Record<string, string> = {
  connected: "Google Calendar conectado. Elegí qué calendarios ver.",
  access_denied: "Cancelaste la conexión con Google.",
  admin_policy_enforced: "El administrador de tu cuenta de Google bloquea apps externas. Usá la dirección iCal de cada calendario (abajo).",
  forbidden: "Google no permitió el acceso. Probá con la dirección iCal (abajo).",
  invalid_grant: "Google rechazó la conexión. Probá conectar de nuevo.",
  state: "La conexión venció o no coincidía. Probá de nuevo.",
};

const MINUTES = ["off", "5", "10", "15", "30"] as const;

/** `?google=…` from the OAuth redirect, read once (the shell renders on the client) and then cleared from the URL. */
function useOAuthResult() {
  const [result] = useState(() => {
    const v = new URLSearchParams(window.location.search).get("google");
    if (v) window.history.replaceState(null, "", window.location.pathname);
    return v;
  });
  return result;
}

export function CalendarSettingsScreen() {
  const result = useOAuthResult();
  const q = useCalendars();
  const status = q.data;
  const r = result ? { text: RESULT[result] ?? `No se pudo conectar con Google (${result}).` } : null;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Google Calendar" back="/ajustes" />
      {r && <Banner kind="info">{r.text}</Banner>}
      {!status ? <TimelineSkeleton heights={[64, 120]} /> : <Content status={status} />}
    </div>
  );
}

function Content({ status }: { status: CalendarStatus }) {
  const direct = useDirect();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const google = status.sources.filter((s) => s.kind === "google");
  const ical = status.sources.filter((s) => s.kind === "ical");
  const g = status.google;

  const sync = async () => {
    setSyncing(true);
    try {
      await direct("POST", "/api/calendars/sync", {}, [["calendars"], ["events"], ["reminders"]]);
      toast({ icon: "check_circle", message: "Calendarios sincronizados" });
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <SectionLabel>Cuenta</SectionLabel>
      {!g.configured ? (
        <p className="px-1 text-body-sm text-text2">
          El servidor no tiene configurado Google (GOOGLE_CLIENT_ID / SECRET). Mientras tanto podés usar la dirección iCal.
        </p>
      ) : (
        <RowGroup>
          <SheetRow
            icon="event"
            label={
              g.connected
                ? `Conectado${g.accountHint ? ` · ${g.accountHint}` : ""}`
                : g.needsReconnect
                  ? "Hay que volver a conectar"
                  : "Sin conectar"
            }
            valueTone="muted"
          />
          {/* a real navigation: the server redirects to Google */}
          {!g.connected && (
            <a href="/api/google/connect" className="flex min-h-14 items-center gap-3 px-3.5 text-[15px] text-accent">
              {g.needsReconnect ? "Volver a conectar" : "Conectar con Google"}
            </a>
          )}
          {(g.connected || g.needsReconnect) && <SheetRow icon="close" label="Desconectar" onClick={() => setConfirm(true)} />}
        </RowGroup>
      )}
      <p className="px-1 text-caption text-muted">
        Agenda lee tus calendarios y nunca los cambia. Si activás la copia, solo escribe en su propio calendario «Agenda».
      </p>
      {g.connected && <CopyEvents copy={g.copyEvents} />}

      {google.length > 0 && (
        <>
          <SectionLabel>Calendarios</SectionLabel>
          <div className="flex flex-col gap-2">
            {google.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        </>
      )}

      <SectionLabel>Dirección iCal</SectionLabel>
      {ical.length > 0 && (
        <div className="flex flex-col gap-2">
          {ical.map((s) => (
            <SourceCard key={s.id} source={s} removable />
          ))}
        </div>
      )}
      {status.canAddIcal ? (
        <IcalForm />
      ) : (
        <p className="px-1 text-body-sm text-text2">Falta ENCRYPTION_KEY en el servidor para guardar direcciones iCal.</p>
      )}

      {status.sources.length > 0 && (
        <Button variant="secondary" icon="sync" disabled={syncing} onClick={() => void sync()}>
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </Button>
      )}

      <BottomSheet open={confirm} onClose={() => setConfirm(false)} label="Desconectar Google Calendar">
        <div className="flex flex-col gap-3">
          <h2 className="text-title text-text">¿Desconectar Google Calendar?</h2>
          <p className="text-body-sm text-text2">
            Se revoca el acceso en Google y se borran de Agenda sus eventos y los avisos que creaste para ellos.
          </p>
          <Button
            variant="danger"
            size="lg"
            onClick={() =>
              void direct("DELETE", "/api/google", undefined, [["calendars"], ["events"], ["reminders"]])
                .then(() => toast({ icon: "check_circle", message: "Google Calendar desconectado" }))
                .catch((e) => toast({ icon: "info", message: (e as Error).message }))
                .finally(() => setConfirm(false))
            }
          >
            Desconectar
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

/** "Copiar mis eventos a Google": the switch, or the reconnect a connection without the permission needs. */
function CopyEvents({ copy }: { copy: CalendarStatus["google"]["copyEvents"] }) {
  const direct = useDirect();
  const toast = useToast();
  const set = (copyEvents: boolean) =>
    void direct("PATCH", "/api/google", { copyEvents }, [["calendars"]])
      .then(() =>
        toast({
          icon: "check_circle",
          message: copyEvents ? "Copiando tus eventos al calendario «Agenda» de Google" : "Ya no se copian tus eventos a Google",
        }),
      )
      .catch((e) => toast({ icon: "info", message: (e as Error).message }));
  const state = !copy.enabled
    ? "Tus eventos de Agenda (también los que crea Sunday) en un calendario «Agenda» de tu Google, sin avisos de Google. Se editan desde Agenda."
    : copy.failed > 0
      ? `${copy.failed} sin copiar${copy.lastError ? `: ${copy.lastError}` : ""}. Se reintenta solo.`
      : copy.pending > 0
        ? `Copiando… (${copy.pending} pendientes)`
        : "Al día. Si lo apagás, lo que ya está en Google queda.";
  return (
    <>
      <SectionLabel>Copiar a Google</SectionLabel>
      {copy.available ? (
        <>
          <RowGroup>
            <SheetRow
              icon="sync"
              label="Copiar mis eventos a Google"
              trailing={<Toggle checked={copy.enabled} onChange={set} label="Copiar mis eventos a Google" />}
            />
          </RowGroup>
          <p className={copy.failed > 0 ? "px-1 text-caption text-danger" : "px-1 text-caption text-muted"}>{state}</p>
        </>
      ) : (
        <Banner
          kind="info"
          title="Falta un permiso"
          action="Volver a conectar"
          onAction={() => {
            window.location.href = "/api/google/connect";
          }}
        >
          Para copiar tus eventos a Google, volvé a conectar y aceptá el permiso de crear el calendario «Agenda».
        </Banner>
      )}
    </>
  );
}

/** One calendar: show/hide, automatic notice, last sync and errors. */
function SourceCard({ source: s, removable }: { source: CalendarSource; removable?: boolean }) {
  const direct = useDirect();
  const toast = useToast();
  const patch = (body: Partial<Pick<CalendarSource, "enabled" | "reminderMinutes">>) =>
    direct("PATCH", `/api/calendars/${s.id}`, body, [["calendars"], ["events"], ["reminders"]]).catch((e) =>
      toast({ icon: "info", message: (e as Error).message }),
    );
  const synced = s.lastSyncedAt
    ? `Sincronizado ${ago(Temporal.Instant.from(s.lastSyncedAt).epochMilliseconds)}`
    : "Todavía sin sincronizar";
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-3 shrink-0 rounded-full bg-accent" style={s.color ? { backgroundColor: s.color } : undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] text-text">{s.name}</span>
          <span className={s.lastError ? "text-caption text-danger" : "text-caption text-muted"}>{s.lastError ?? synced}</span>
        </span>
        <Toggle checked={s.enabled} onChange={(enabled) => void patch({ enabled })} label={`Mostrar ${s.name}`} />
      </div>
      {s.enabled && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Avisarme antes de cada evento (Google ya avisa por su cuenta)</span>
          <Segmented
            value={s.reminderMinutes === null ? "off" : String(s.reminderMinutes)}
            onChange={(v) => void patch({ reminderMinutes: v === "off" ? null : Number(v) })}
            options={MINUTES.map((m) => ({ value: m, label: m === "off" ? "No" : `${m} min` }))}
          />
        </div>
      )}
      {removable && (
        <Button
          variant="ghost"
          icon="delete"
          onClick={() =>
            void direct("DELETE", `/api/calendars/${s.id}`, undefined, [["calendars"], ["events"]]).catch((e) =>
              toast({ icon: "info", message: (e as Error).message }),
            )
          }
        >
          Quitar
        </Button>
      )}
    </div>
  );
}

function IcalForm() {
  const direct = useDirect();
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await direct("POST", "/api/calendars/ical", { name: name.trim(), url: url.trim() }, [["calendars"], ["events"]]);
      toast({ icon: "check_circle", message: `"${name.trim()}" agregado` });
      setName("");
      setUrl("");
    } catch (e) {
      toast({ icon: "info", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <p className="px-1 text-body-sm text-text2">
        Plan B si Google no deja conectar: en Google Calendar → configuración del calendario → “Dirección secreta en formato iCal”.
      </p>
      <TextField
        label="Nombre"
        placeholder="Nombre (por ejemplo Personal)"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      <TextField
        label="Dirección iCal"
        placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
        value={url}
        inputMode="url"
        autoComplete="off"
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button type="submit" disabled={busy || !name.trim() || url.trim().length < 10}>
        {busy ? "Verificando…" : "Agregar calendario"}
      </Button>
    </form>
  );
}

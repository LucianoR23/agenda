"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { ApiProblem } from "@/client/api";
import { useDevices, useDirect, useSession } from "@/client/queries";
import type { Device } from "@/client/types";
import { Button, Toggle } from "../components/controls";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { RowGroup, SheetRow } from "../components/surfaces";
import { localHHmm } from "../format";
import { addDays, todayART } from "../time";

const field = "h-12 w-full rounded-md border border-border2 bg-surface px-3.5 font-mono text-body text-text outline-none focus:border-accent";
const PIN = /^\d{6}$/;

type Sheet = { kind: "pin" } | { kind: "codes" } | { kind: "device"; device: Device } | null;

/** "hoy 17:31", "ayer 09:10", "12/10 20:00". */
function seen(iso: string) {
  const day = iso.slice(0, 10);
  const today = todayART();
  const when = day === today ? "hoy" : day === addDays(today, -1) ? "ayer" : `${day.slice(8)}/${day.slice(5, 7)}`;
  return `${when} ${localHHmm(iso)}`;
}

const err = (e: unknown) => (e instanceof ApiProblem ? (e.problem.code === "invalid_credentials" ? `PIN incorrecto. Te quedan ${e.problem.remainingAttempts ?? "?"} intentos.` : (e.problem.detail ?? e.problem.title)) : (e as Error).message);

export function SecurityScreen() {
  const session = useSession().data;
  const devices = useDevices().data?.devices ?? [];
  const direct = useDirect();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);

  const enableFingerprint = async (on: boolean) => {
    try {
      if (on) {
        const options = await direct<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/api/auth/passkey/register/options");
        const response = await startRegistration({ optionsJSON: options });
        await direct("POST", "/api/auth/passkey/register/verify", { response }, [["session"], ["devices"]]);
        toast({ icon: "fingerprint", message: "Huella activada en este dispositivo" });
      } else {
        await direct("DELETE", "/api/auth/passkey", undefined, [["session"], ["devices"]]);
      }
    } catch (e) {
      toast({ icon: "info", message: e instanceof ApiProblem ? err(e) : "No se pudo registrar la huella." });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Seguridad" back="/ajustes" />

      <SectionLabel>Este dispositivo</SectionLabel>
      <RowGroup>
        <SheetRow icon="fingerprint" label="Desbloquear con huella" trailing={<Toggle checked={!!session?.passkeyEnabled} onChange={(v) => void enableFingerprint(v)} label="Desbloquear con huella" />} />
        <SheetRow icon="key" label="Cambiar PIN" chevron onClick={() => setSheet({ kind: "pin" })} />
        <SheetRow icon="sync" label="Regenerar códigos de recuperación" chevron onClick={() => setSheet({ kind: "codes" })} />
      </RowGroup>

      <SectionLabel>Dispositivos</SectionLabel>
      <RowGroup>
        {devices.map((d) => (
          <button key={d.id} type="button" onClick={() => setSheet({ kind: "device", device: d })} className="flex min-h-16 items-center gap-3 px-3.5 text-left">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-surface2 text-text2">
              <Icon name="devices" />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] text-text">
                {d.name}
                {d.current && <span className="text-accent"> · este</span>}
              </span>
              <span className="text-caption text-muted">
                Visto {seen(d.lastSeenAt)}
                {d.passkeyEnabled ? " · huella" : ""}
              </span>
            </span>
            <Icon name="chevron_right" className="text-muted" />
          </button>
        ))}
      </RowGroup>
      <p className="px-1 text-caption text-muted">El PIN se pide de nuevo si un dispositivo no se usa por más de 7 días.</p>

      <BottomSheet open={sheet?.kind === "pin"} onClose={() => setSheet(null)} label="Cambiar PIN">
        {sheet?.kind === "pin" && <ChangePin onDone={() => (setSheet(null), toast({ icon: "check_circle", message: "PIN actualizado" }))} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "codes"} onClose={() => setSheet(null)} label="Códigos de recuperación">
        {sheet?.kind === "codes" && <RegenerateCodes />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "device"} onClose={() => setSheet(null)} label="Dispositivo">
        {sheet?.kind === "device" && <DeviceSheet device={sheet.device} onDone={() => setSheet(null)} />}
      </BottomSheet>
    </div>
  );
}

function ChangePin({ onDone }: { onDone: () => void }) {
  const direct = useDirect();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Cambiar PIN</h2>
      <input aria-label="PIN actual" type="password" inputMode="numeric" maxLength={6} placeholder="PIN actual" value={cur} onChange={(e) => setCur(e.target.value)} className={field} />
      <input aria-label="PIN nuevo" type="password" inputMode="numeric" maxLength={6} placeholder="PIN nuevo (6 dígitos)" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={!PIN.test(cur) || !PIN.test(next)} onClick={() => direct("POST", "/api/auth/pin", { currentPin: cur, newPin: next }).then(onDone, (e) => setError(err(e)))}>
        Guardar
      </Button>
    </div>
  );
}

function RegenerateCodes() {
  const direct = useDirect();
  const [pin, setPin] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (codes)
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-title text-text">Códigos nuevos</h2>
        <p className="text-body-sm text-text2">Los anteriores ya no sirven. Guardalos fuera del celular.</p>
        <ol className="grid grid-cols-2 gap-2 rounded-lg bg-surface p-3.5 font-mono text-[15px] text-text">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <Button variant="secondary" icon="check" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
          Copiar
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Regenerar códigos</h2>
      <p className="text-body-sm text-text2">Confirmá con tu PIN. Los 10 códigos anteriores dejan de funcionar.</p>
      <input aria-label="PIN" type="password" inputMode="numeric" maxLength={6} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} className={field} />
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={!PIN.test(pin)} onClick={() => direct<{ recoveryCodes: string[] }>("POST", "/api/auth/recovery-codes", { pin }).then((r) => setCodes(r.recoveryCodes), (e) => setError(err(e)))}>
        Regenerar
      </Button>
    </div>
  );
}

function DeviceSheet({ device, onDone }: { device: Device; onDone: () => void }) {
  const direct = useDirect();
  const [name, setName] = useState(device.name);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">{device.name}</h2>
      <p className="text-caption text-muted">{device.userAgent}</p>
      <input aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} className={field.replace("font-mono ", "")} />
      <Button size="lg" disabled={!name.trim() || name === device.name} onClick={() => direct("PATCH", `/api/auth/devices/${device.id}`, { name: name.trim() }, [["devices"]]).then(onDone)}>
        Renombrar
      </Button>
      <Button variant="danger" onClick={() => direct("DELETE", `/api/auth/devices/${device.id}`, undefined, [["devices"], ["session"]]).then(onDone)}>
        {device.current ? "Cerrar sesión en este dispositivo" : "Revocar acceso"}
      </Button>
    </div>
  );
}

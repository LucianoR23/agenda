"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiProblem } from "@/client/api";
import type { SessionState } from "@/client/types";
import { Button, Segmented } from "../components/controls";
import { Icon } from "../components/icon";
import { PinPad } from "../components/pin-pad";
import { haptic } from "../time";

/** 6-digit PIN entry (keypad + physical keyboard). Calls onComplete with the PIN. */
function usePin(onComplete: (pin: string, reset: () => void) => void, active = true, length = 6) {
  const [digits, setDigits] = useState("");
  // the source of truth lives in a ref so completion fires exactly once (state updaters may run twice)
  const value = useRef("");
  const done = useRef(onComplete);
  useEffect(() => {
    done.current = onComplete;
  });
  const reset = useCallback(() => {
    value.current = "";
    setDigits("");
  }, []);
  const push = useCallback(
    (d: string) => {
      if (value.current.length >= length) return;
      value.current += d;
      setDigits(value.current);
      haptic(8);
      if (value.current.length === length) done.current(value.current, reset);
    },
    [length, reset],
  );
  const back = useCallback(() => {
    value.current = value.current.slice(0, -1);
    setDigits(value.current);
  }, []);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^\d$/.test(e.key)) push(e.key);
      if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, back, active]);
  return { digits, push, back, reset };
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 pt-safe pb-safe">{children}</main>;
}

function Brand() {
  return (
    <div className="flex flex-col items-center gap-1">
      <Image src="/icons/icon-any.svg" width={56} height={56} alt="" unoptimized priority />
      <span className="font-mono text-mono tracking-[.08em] text-muted">AGENDA</span>
    </div>
  );
}

const problemText = (e: unknown) => {
  if (!(e instanceof ApiProblem)) return "Algo salió mal.";
  if (e.offline) return "Sin conexión.";
  const p = e.problem;
  if (p.code === "locked_out") return `Demasiados intentos. Probá en ${Math.ceil((p.retryAfterSeconds ?? 60) / 60)} min.`;
  if (p.code === "invalid_credentials") return p.remainingAttempts !== undefined ? `Incorrecto. Te quedan ${p.remainingAttempts} intentos.` : "Código incorrecto.";
  return p.detail ?? p.title;
};

// ---------- setup ----------

export function SetupScreen() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"code" | "pin" | "confirm" | "codes">("code");
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);

  const create = usePin((pin) => {
    setFirst(pin);
    setError(null);
    setStep("confirm");
  }, step === "pin");
  const confirm = usePin(async (pin, resetConfirm) => {
    if (pin !== first) {
      setError("Los PIN no coinciden.");
      resetConfirm();
      create.reset();
      setStep("pin");
      return;
    }
    try {
      const r = await api<{ recoveryCodes: string[] }>("POST", "/api/auth/setup", { setupCode: code, pin, deviceName: undefined });
      setCodes(r.data.recoveryCodes);
      setStep("codes");
    } catch (e) {
      setError(problemText(e));
      resetConfirm();
      create.reset();
      setStep(e instanceof ApiProblem && e.problem.code === "invalid_credentials" ? "code" : "pin");
    }
  }, step === "confirm");

  if (step === "code")
    return (
      <Screen>
        <Brand />
        <div className="flex w-full max-w-sm flex-col gap-3">
          <h1 className="text-title text-text">Configurar Agenda</h1>
          <p className="text-body-sm text-text2">Ingresá el código de configuración del servidor (SETUP_CODE). Se usa una sola vez.</p>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Código de configuración"
            className="h-12 rounded-md border border-border2 bg-surface px-3.5 text-body text-text outline-none focus:border-accent"
          />
          {error && <p className="text-caption text-danger">{error}</p>}
          <Button size="lg" disabled={!code} onClick={() => setStep("pin")}>
            Continuar
          </Button>
        </div>
      </Screen>
    );
  if (step === "pin" || step === "confirm") {
    const pad = step === "pin" ? create : confirm;
    return (
      <Screen>
        <Brand />
        <PinPad title={step === "pin" ? "Elegí un PIN de 6 dígitos" : "Repetí el PIN"} filled={pad.digits.length} error={error} onDigit={pad.push} onBackspace={pad.back} recoverLabel={null} />
      </Screen>
    );
  }
  const text = codes.join("\n");
  return (
    <Screen>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <span className="flex items-center gap-2 text-caption text-success">
          <Icon name="check_circle" size={16} /> Listo, este dispositivo ya es de confianza
        </span>
        <h1 className="text-title text-text">Códigos de recuperación</h1>
        <p className="text-body-sm text-text2">Si olvidás el PIN, cada código sirve una vez. Guardalos fuera del celular: no se vuelven a mostrar.</p>
        <ol className="grid grid-cols-2 gap-2 rounded-lg bg-surface p-3.5 font-mono text-[15px] text-text" data-testid="recovery-codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button variant="secondary" icon="check" className="flex-1" onClick={() => navigator.clipboard?.writeText(text)}>
            Copiar
          </Button>
          <Button variant="secondary" icon="download" className="flex-1" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Agenda — códigos de recuperación\n\n${text}\n`)}`}>
            Descargar
          </Button>
        </div>
        <Button size="lg" onClick={() => qc.invalidateQueries({ queryKey: ["session"] })}>
          Ya los guardé
        </Button>
      </div>
    </Screen>
  );
}

// ---------- unlock ----------

export function UnlockScreen({ session }: { session: SessionState }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [recover, setRecover] = useState(false);
  const tried = useRef(false);

  const unlocked = () => qc.invalidateQueries();

  const pin = usePin(async (value, reset) => {
    try {
      await api("POST", "/api/auth/unlock", { pin: value });
      await unlocked();
    } catch (e) {
      haptic(40);
      setError(problemText(e));
      reset();
    }
  });

  const fingerprint = useCallback(async () => {
    try {
      const { data: options } = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("POST", "/api/auth/passkey/auth/options");
      const response = await startAuthentication({ optionsJSON: options });
      await api("POST", "/api/auth/passkey/auth/verify", { response });
      await unlocked();
    } catch (e) {
      if (e instanceof ApiProblem) setError(problemText(e));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // fingerprint first on devices that enabled it, PIN as fallback
  useEffect(() => {
    if (session.passkeyEnabled && session.state === "locked" && !tried.current) {
      tried.current = true;
      void fingerprint();
    }
  }, [session, fingerprint]);

  if (recover) return <RecoverScreen onBack={() => setRecover(false)} />;
  return (
    <Screen>
      <Brand />
      {session.state === "unauthenticated" && <p className="max-w-xs text-center text-body-sm text-text2">Dispositivo nuevo: ingresá tu PIN para confiar en él.</p>}
      {session.state === "locked" && <p className="max-w-xs text-center text-body-sm text-text2">Hace más de 7 días que no usás este dispositivo.</p>}
      <PinPad
        filled={pin.digits.length}
        fingerprint={session.passkeyEnabled && session.state === "locked"}
        error={error ?? (session.lockedUntil ? "Bloqueado por intentos fallidos. Esperá unos minutos." : null)}
        onDigit={pin.push}
        onBackspace={pin.back}
        onFingerprint={fingerprint}
        onRecover={() => setRecover(true)}
      />
    </Screen>
  );
}

// ---------- recover ----------

function RecoverScreen({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<"recovery_code" | "reset_code">("recovery_code");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"code" | "pin" | "done">("code");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pin = usePin(async (newPin, reset) => {
    try {
      const r = await api<{ remainingRecoveryCodes: number }>("POST", "/api/auth/recover", { method, code, newPin });
      setRemaining(r.data.remainingRecoveryCodes);
      setStep("done");
    } catch (e) {
      setError(problemText(e));
      reset();
      setStep("code");
    }
  }, step === "pin");

  if (step === "pin")
    return (
      <Screen>
        <PinPad title="Elegí un PIN nuevo" filled={pin.digits.length} error={error} onDigit={pin.push} onBackspace={pin.back} recoverLabel={null} />
      </Screen>
    );
  if (step === "done")
    return (
      <Screen>
        <div className="flex w-full max-w-sm flex-col gap-4 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <Icon name="check_circle" size={28} />
          </span>
          <h1 className="text-title text-text">PIN actualizado</h1>
          {method === "recovery_code" && <p className="text-body-sm text-text2">Te quedan {remaining} códigos de recuperación.</p>}
          <Button size="lg" onClick={() => qc.invalidateQueries()}>
            Entrar
          </Button>
        </div>
      </Screen>
    );
  return (
    <Screen>
      <div className="flex w-full max-w-sm flex-col gap-4">
        <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1 self-start text-body-sm text-accent">
          <Icon name="chevron_left" size={18} /> Volver
        </button>
        <h1 className="text-title text-text">Olvidé mi PIN</h1>
        <Segmented
          value={method}
          onChange={(m) => setMethod(m)}
          options={[
            { value: "recovery_code", label: "Código de recuperación" },
            { value: "reset_code", label: "Código del servidor" },
          ]}
        />
        <p className="text-body-sm text-text2">
          {method === "recovery_code"
            ? "Uno de los 10 códigos que guardaste al configurar (XXXX-XXXX-XXXX)."
            : "El código de 8 dígitos que imprime `pnpm auth:reset-pin` en la terminal del contenedor (vale 15 min)."}
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={method === "reset_code" ? "numeric" : "text"}
          autoCapitalize="characters"
          placeholder={method === "recovery_code" ? "K7QM-2XPA-9TRC" : "58302917"}
          className="h-12 rounded-md border border-border2 bg-surface px-3.5 font-mono text-body text-text outline-none focus:border-accent"
        />
        {error && <p className="text-caption text-danger">{error}</p>}
        <Button size="lg" disabled={code.trim().length < 4} onClick={() => (setError(null), setStep("pin"))}>
          Continuar
        </Button>
      </div>
    </Screen>
  );
}

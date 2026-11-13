"use client";

import { useState } from "react";
import { ApiProblem } from "@/client/api";
import { useDirect, useTokens } from "@/client/queries";
import type { ApiToken, TokenCreated, TokenScope } from "@/client/types";
import { Button, TextField, Toggle } from "../components/controls";
import { Icon } from "../components/icon";
import { BottomSheet, useToast } from "../components/overlay";
import { PageTitle, SectionLabel } from "../components/page";
import { EmptyState, RowGroup, SheetRow } from "../components/surfaces";
import { seenLabel } from "../time";

const SCOPES: Array<{ scope: TokenScope; label: string; hint: string }> = [
  { scope: "read", label: "Leer", hint: "Consultar tu agenda" },
  { scope: "write", label: "Escribir", hint: "Crear y cambiar tareas, recordatorios y eventos" },
  { scope: "notify", label: "Notificar", hint: "Mandarte notificaciones" },
];
const PIN = /^\d{6}$/;

const message = (e: unknown) => (e instanceof ApiProblem ? e.problem.message : "Algo salió mal.");
const needsReauth = (e: unknown) => e instanceof ApiProblem && e.problem.code === "REAUTH_REQUIRED";

type Sheet = { kind: "create" } | { kind: "created"; token: TokenCreated } | { kind: "revoke"; token: ApiToken } | null;

/** Ajustes → Tokens de API: what Sunday uses to read and write the agenda. */
export function TokensScreen() {
  const tokens = useTokens().data?.tokens ?? [];
  const [sheet, setSheet] = useState<Sheet>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Tokens de API" back="/ajustes" />
      <p className="px-1 text-body-sm text-text2">
        Sunday usa un token para leer y escribir tu agenda. Cada token se muestra una sola vez; si lo perdés, revocalo y creá otro.
      </p>

      {tokens.length === 0 ? (
        <EmptyState
          icon="key"
          title="Sin tokens"
          body="Creá uno para conectar Sunday."
          actions={<Button onClick={() => setSheet({ kind: "create" })}>Crear token</Button>}
        />
      ) : (
        <>
          <SectionLabel>Activos</SectionLabel>
          <RowGroup>
            {tokens.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSheet({ kind: "revoke", token: t })}
                className="flex min-h-16 items-center gap-3 px-3.5 text-left"
              >
                <span className="flex size-9 items-center justify-center rounded-[10px] bg-surface2 text-text2">
                  <Icon name="key" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] text-text">
                    {t.name} <span className="font-mono text-caption text-muted">{t.prefix}…</span>
                  </span>
                  <span className="text-caption text-muted">
                    {t.scopes.map((s) => SCOPES.find((x) => x.scope === s)?.label ?? s).join(" · ")} ·{" "}
                    {t.lastUsedAt ? `usado ${seenLabel(t.lastUsedAt)}` : "nunca usado"}
                  </span>
                </span>
                <Icon name="chevron_right" className="text-muted" />
              </button>
            ))}
          </RowGroup>
          <Button variant="secondary" icon="add" onClick={() => setSheet({ kind: "create" })}>
            Crear token
          </Button>
        </>
      )}

      <BottomSheet open={sheet?.kind === "create"} onClose={() => setSheet(null)} label="Crear token">
        {sheet?.kind === "create" && <CreateToken onCreated={(token) => setSheet({ kind: "created", token })} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "created"} onClose={() => setSheet(null)} label="Token creado">
        {sheet?.kind === "created" && <CreatedToken token={sheet.token} onDone={() => setSheet(null)} />}
      </BottomSheet>
      <BottomSheet open={sheet?.kind === "revoke"} onClose={() => setSheet(null)} label="Revocar token">
        {sheet?.kind === "revoke" && <RevokeToken token={sheet.token} onDone={() => setSheet(null)} />}
      </BottomSheet>
    </div>
  );
}

/** Asks for the PIN when the server wants a fresh confirmation (5-minute window), then retries the action. */
function useReauthRetry() {
  const direct = useDirect();
  const [asking, setAsking] = useState<null | (() => Promise<void>)>(null);
  const run = async (action: () => Promise<void>, onError: (m: string) => void) => {
    try {
      await action();
    } catch (e) {
      if (needsReauth(e)) setAsking(() => action);
      else onError(message(e));
    }
  };
  const confirm = async (pin: string) => {
    await direct("POST", "/api/auth/reauth", { pin });
    const retry = asking;
    setAsking(null);
    await retry?.();
  };
  return { asking: asking !== null, run, confirm, cancel: () => setAsking(null) };
}

function PinConfirm({ onConfirm, onCancel }: { onConfirm: (pin: string) => Promise<void>; onCancel: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Confirmá tu PIN</h2>
      <p className="text-body-sm text-text2">Para crear o revocar tokens pedimos el PIN otra vez (vale 5 minutos).</p>
      <TextField
        label="PIN"
        mono
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={!PIN.test(pin)} onClick={() => onConfirm(pin).catch((e) => setError(message(e)))}>
        Confirmar
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

function CreateToken({ onCreated }: { onCreated: (t: TokenCreated) => void }) {
  const direct = useDirect();
  const reauth = useReauthRetry();
  const [name, setName] = useState("sunday");
  const [scopes, setScopes] = useState<TokenScope[]>(["read", "write", "notify"]);
  const [error, setError] = useState<string | null>(null);
  const toggle = (s: TokenScope, on: boolean) => setScopes((xs) => (on ? [...new Set([...xs, s])] : xs.filter((x) => x !== s)));
  const create = () =>
    reauth.run(async () => {
      const t = await direct<TokenCreated>("POST", "/api/tokens", { name: name.trim(), scopes }, [["tokens"]]);
      onCreated(t);
    }, setError);

  if (reauth.asking) return <PinConfirm onConfirm={reauth.confirm} onCancel={reauth.cancel} />;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Crear token</h2>
      <TextField label="Nombre" hideLabel={false} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <RowGroup>
        {SCOPES.map((s) => (
          <SheetRow
            key={s.scope}
            icon={s.scope === "read" ? "checklist" : s.scope === "write" ? "edit" : "notifications"}
            label={`${s.label}: ${s.hint}`}
            trailing={<Toggle checked={scopes.includes(s.scope)} onChange={(on) => toggle(s.scope, on)} label={s.label} />}
          />
        ))}
      </RowGroup>
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={!name.trim() || scopes.length === 0} onClick={() => void create()}>
        Crear
      </Button>
    </div>
  );
}

function CreatedToken({ token, onDone }: { token: TokenCreated; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">Token "{token.name}"</h2>
      <p className="text-body-sm text-text2">Copialo ahora y pegalo en Sunday. No se va a volver a mostrar.</p>
      <code className="break-all rounded-lg bg-surface p-3.5 font-mono text-[14px] text-text">{token.token}</code>
      <Button
        variant="secondary"
        icon="content_copy"
        onClick={() =>
          navigator.clipboard
            ?.writeText(token.token)
            .then(() => toast({ icon: "check_circle", message: "Token copiado" }))
            .catch(() => toast({ icon: "info", message: "No se pudo copiar; seleccionalo a mano." }))
        }
      >
        Copiar
      </Button>
      <Button size="lg" onClick={onDone}>
        Listo
      </Button>
    </div>
  );
}

function RevokeToken({ token, onDone }: { token: ApiToken; onDone: () => void }) {
  const direct = useDirect();
  const reauth = useReauthRetry();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const revoke = () =>
    reauth.run(async () => {
      await direct("DELETE", `/api/tokens/${token.id}`, undefined, [["tokens"]]);
      toast({ icon: "check_circle", message: `Token "${token.name}" revocado` });
      onDone();
    }, setError);

  if (reauth.asking) return <PinConfirm onConfirm={reauth.confirm} onCancel={reauth.cancel} />;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-title text-text">{token.name}</h2>
      <p className="text-caption text-muted">
        {token.prefix}… · creado {seenLabel(token.createdAt)}
        {token.lastUsedIp ? ` · última IP ${token.lastUsedIp}` : ""}
      </p>
      <p className="text-body-sm text-text2">
        Si lo revocás, deja de funcionar al instante y Sunday no va a poder usar tu agenda hasta que cargues uno nuevo.
      </p>
      {error && <p className="text-caption text-danger">{error}</p>}
      <Button variant="danger" icon="delete" onClick={() => void revoke()}>
        Revocar
      </Button>
    </div>
  );
}

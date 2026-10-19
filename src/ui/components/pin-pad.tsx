"use client";

import { cx } from "../cx";
import { Icon } from "./icon";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** PIN keypad (72 px keys). 6 dots; fingerprint key only when the device has a passkey. */
export function PinPad({
  title = "Ingresá tu PIN",
  filled,
  length = 6,
  fingerprint,
  error,
  onDigit,
  onBackspace,
  onFingerprint,
  onRecover,
}: {
  title?: string;
  filled: number;
  length?: number;
  fingerprint?: boolean;
  error?: string | null;
  onDigit?: (d: string) => void;
  onBackspace?: () => void;
  onFingerprint?: () => void;
  onRecover?: () => void;
}) {
  const key = "flex size-[72px] items-center justify-center rounded-full";
  return (
    <div className="flex flex-col items-center gap-[18px]">
      <h1 className="text-headline text-text">{title}</h1>
      <div className="flex gap-3.5" role="img" aria-label={`${filled} de ${length} dígitos`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cx("size-3.5 rounded-full", i < filled ? "bg-text" : "border-[1.5px] border-border2", error && "border-danger")} />
        ))}
      </div>
      <p className="min-h-5 text-caption text-danger" aria-live="assertive">
        {error}
      </p>
      <div className="grid grid-cols-[repeat(3,72px)] gap-x-7 gap-y-3.5">
        {DIGITS.map((d) => (
          <button key={d} type="button" onClick={() => onDigit?.(d)} className={cx(key, "bg-surface text-[26px] font-medium text-text active:bg-raised")}>
            {d}
          </button>
        ))}
        {fingerprint ? (
          <button type="button" aria-label="Desbloquear con huella" onClick={onFingerprint} className={cx(key, "text-text2")}>
            <Icon name="fingerprint" size={28} />
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => onDigit?.("0")} className={cx(key, "bg-surface text-[26px] font-medium text-text active:bg-raised")}>
          0
        </button>
        <button type="button" aria-label="Borrar" onClick={onBackspace} className={cx(key, "text-text2")}>
          <Icon name="backspace" size={28} />
        </button>
      </div>
      <button type="button" onClick={onRecover} className="flex min-h-11 items-center text-body-sm text-accent">
        Usar código de recuperación
      </button>
    </div>
  );
}

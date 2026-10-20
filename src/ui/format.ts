/** Block time `HH:mm` (00:00–29:59) → display time and whether it falls on the next day. */
export function blockTime(t: string): { text: string; nextDay: boolean } {
  const h = Number(t.slice(0, 2));
  if (h < 24) return { text: t, nextDay: false };
  return { text: `${String(h - 24).padStart(2, "0")}${t.slice(2)}`, nextDay: true };
}

/** "10:00–10:45", "23:30–07:00 (+1)", "24:15–07:45" → "00:15 (+1)–07:45". */
export function blockRange(start: string, end: string | null): string {
  const s = blockTime(start);
  const left = s.nextDay ? `${s.text} (+1)` : s.text;
  if (!end) return left;
  const e = blockTime(end);
  const endsNextDay = !s.nextDay && (e.nextDay || end < start);
  return `${left}–${e.text}${endsNextDay ? " (+1)" : ""}`;
}

export const OUTCOME_LABEL = {
  closed_won: "Cerrada",
  follow_up: "Seguimiento",
  lost: "No cerrada",
  qualified: "Calificada",
  not_qualified: "No calificada",
  no_show: "No se presentó",
  rescheduled: "Reprogramada",
} as const;

export const CALL_KIND_LABEL = { closer: "Closer", triage: "Triage" } as const;

export const STATUS_LABEL = { pending: "Pendiente", done: "Hecho", skipped: "Salteado" } as const;

/** Minutes → "6 h 50 min". */
export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Timestamp → local `HH:mm` in America/Buenos_Aires. */
export function localHHmm(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Buenos_Aires",
  }).format(new Date(iso));
}

/** Opens the chat with the lead (WhatsApp number, else the phone), no prefilled message. */
export function whatsappLink(lead: { whatsapp?: string | null; phone?: string | null }): string | null {
  const digits = (lead.whatsapp ?? lead.phone ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

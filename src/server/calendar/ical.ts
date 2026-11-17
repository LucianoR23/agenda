import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ical, { type VEvent } from "node-ical";
import type { Incoming } from "./types";

/**
 * iCal fallback (docs/v2/06): the calendar's secret address, fetched every 15 min and expanded with node-ical
 * (RRULE, EXDATE and RECURRENCE-ID overrides) inside the sync window.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export class IcalError extends Error {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let transport: Fetch = (url, init) => fetch(url, init);
/** Tests: serve fixtures instead of the network (also skips the DNS check). */
let checkHost = true;
export function setIcalFetch(f: Fetch | null) {
  transport = f ?? ((url, init) => fetch(url, init));
  checkHost = f === null;
}

/** Loopback, private, link-local, CGNAT, unique-local and unspecified addresses (no fetching the server's own network). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb")
  );
}

/** Only public https URLs (the address is resolved and checked before every request). */
export async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.replace(/^webcal:\/\//i, "https://"));
  } catch {
    throw new IcalError("La dirección iCal no es una URL válida.");
  }
  if (url.protocol !== "https:") throw new IcalError("La dirección iCal tiene que empezar con https://.");
  if (url.username || url.password) throw new IcalError("La dirección iCal no puede llevar usuario ni contraseña.");
  if (!checkHost) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new IcalError(`No encontré el servidor ${url.hostname}.`);
  if (addresses.some(isPrivateAddress)) throw new IcalError("La dirección iCal apunta a una red privada.");
  return url;
}

/** Downloads the calendar: https only, public hosts only, redirects re-checked, 5 MB and 20 s at most. */
export async function fetchIcal(raw: string): Promise<string> {
  let url = await assertPublicHttps(raw);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await transport(url.toString(), {
        redirect: "manual",
        headers: { Accept: "text/calendar, text/plain;q=0.8" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new IcalError(`No pude descargar el calendario (${(err as Error).name}).`);
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next || hop >= MAX_REDIRECTS) throw new IcalError("La dirección iCal redirige demasiadas veces.");
      url = await assertPublicHttps(new URL(next, url).toString());
      continue;
    }
    if (res.status === 404 || res.status === 403 || res.status === 401)
      throw new IcalError("El calendario ya no está disponible en esa dirección (¿se regeneró la dirección secreta?).");
    if (!res.ok) throw new IcalError(`El servidor del calendario respondió HTTP ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new IcalError("El calendario es demasiado grande (más de 5 MB).");
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new IcalError("El calendario es demasiado grande (más de 5 MB).");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}

const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "val" in v && typeof v.val === "string") return v.val.trim() || null;
  return null;
};

/**
 * A DATE value as `YYYY-MM-DD`. node-ical turns it into midnight of *some* zone (the calendar's or the process's), so
 * the UTC date half a day later is the right one for any zone between UTC−11 and UTC+11.
 */
const dateOnly = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime()).add({ hours: 12 }).toString().slice(0, 10);

const instant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());

/** Parses and expands every VEVENT overlapping [from, to). */
export function parseIcal(body: string, from: Temporal.Instant, to: Temporal.Instant): Incoming[] {
  let data: ReturnType<typeof ical.sync.parseICS>;
  try {
    data = ical.sync.parseICS(body);
  } catch {
    throw new IcalError("El archivo no es un calendario iCal válido.");
  }
  if (!/BEGIN:VCALENDAR/i.test(body)) throw new IcalError("El archivo no es un calendario iCal válido.");
  const out: Incoming[] = [];
  const range = { from: new Date(from.epochMilliseconds), to: new Date(to.epochMilliseconds) };
  for (const item of Object.values(data)) {
    if (item?.type !== "VEVENT") continue;
    const ev = item as VEvent;
    if (!ev.start) continue;
    let instances: ReturnType<typeof ical.expandRecurringEvent>;
    try {
      instances = ical.expandRecurringEvent(ev, { ...range, expandOngoing: true, maxIterations: 5000 });
    } catch {
      continue; // one broken rule shouldn't hide the rest of the calendar
    }
    for (const i of instances) {
      const source = i.event as VEvent;
      if (source.status === "CANCELLED") continue;
      const key = i.isOverride && source.recurrenceid ? source.recurrenceid : i.start;
      const base = {
        externalId: `${ev.uid}|${i.isFullDay ? dateOnly(key) : instant(key).toString()}`.slice(0, 1000),
        title: text(i.summary) ?? text(source.summary) ?? "(Sin título)",
        location: text(source.location),
        status: source.status === "TENTATIVE" ? ("tentative" as const) : ("confirmed" as const),
        htmlLink: null,
        updatedRemoteAt: source.lastmodified ? instant(source.lastmodified) : null,
      };
      if (i.isFullDay) {
        const startDate = dateOnly(i.start);
        const endDate = i.end ? dateOnly(i.end) : null;
        out.push({
          ...base,
          allDay: true,
          startsAt: null,
          endsAt: null,
          startDate,
          endDate: endDate && endDate > startDate ? endDate : Temporal.PlainDate.from(startDate).add({ days: 1 }).toString(),
        });
      } else {
        out.push({
          ...base,
          allDay: false,
          startsAt: instant(i.start),
          endsAt: i.end ? instant(i.end) : null,
          startDate: null,
          endDate: null,
        });
      }
    }
  }
  return out;
}

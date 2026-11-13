/**
 * Structured logger: one JSON object per line (stdout for debug/info, stderr for warn/error), level from
 * `LOG_LEVEL`. Secrets are redacted by key name and by value pattern before anything is written.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never logged (headers, credentials, hashes, one-time codes). */
const SECRET_KEY =
  /^(authorization|cookie|set-cookie|x-api-key|x-internal-token)$|token|secret|password|passwd|^pin$|pin_?hash|session_?hash|setup_?code|recovery_?code|reset_?code|private_?key|encryption_?key|api_?key|p256dh|^auth$/i;

/** Secret-looking substrings inside free text (messages, stacks, URLs). */
const SECRET_VALUE: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]"],
  [/(\w+:\/\/[^:/\s]+:)[^@\s]+@/g, "$1[REDACTED]@"], // credentials in URLs (postgres://user:pass@host)
  [/\b(agenda_session|agenda_dk)=[^;\s]+/g, "$1=[REDACTED]"],
];

export const REDACTED = "[REDACTED]";

const scrub = (s: string) => SECRET_VALUE.reduce((acc, [re, to]) => acc.replace(re, to), s);

/** Deep copy with secrets replaced. Handles errors, cycles and depth. Exported for tests. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return typeof value === "bigint" ? value.toString() : value;
  if (depth > 6) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) {
    const out: Fields = { name: value.name, message: scrub(value.message) };
    if (value.stack) out.stack = scrub(value.stack);
    if (value.cause !== undefined) out.cause = redact(value.cause, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Headers) return redact(Object.fromEntries(value), depth, seen);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1, seen);
  return out;
}

function threshold(): number {
  const level = process.env.LOG_LEVEL as Level | undefined;
  return ORDER[level && level in ORDER ? level : "info"];
}

function write(level: Level, msg: string, fields?: Fields) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg: scrub(msg), ...(fields ? (redact(fields) as Fields) : {}) });
  if (ORDER[level] >= ORDER.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

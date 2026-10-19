import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). Tests lower the memory via ARGON2_MEMORY_KIB. */
export const hashSecret = (secret: string) =>
  argonHash(secret, { memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19_456), timeCost: 2, parallelism: 1, algorithm: 2 });
export const verifySecret = (hash: string, secret: string) => argonVerify(hash, secret).catch(() => false);

/** Compact signed value `payload.signature` (HMAC-SHA256, base64url), for short-lived cookies. */
export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function unsign<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  if (!safeEqual(createHmac("sha256", secret).update(body).digest("base64url"), mac)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** Recovery code `XXXX-XXXX-XXXX`. */
export function recoveryCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

/** Normalizes user input: uppercase, strips spaces, re-inserts dashes. */
export function normalizeRecoveryCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` : raw;
}

/** 8-digit numeric reset code for `pnpm auth:reset-pin`. */
export const resetCode = () => String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, "0");

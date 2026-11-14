import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";
import { ApiError } from "../http/errors";

/**
 * AES-256-GCM for secrets at rest (Google refresh token, iCal secret URLs), keyed by `ENCRYPTION_KEY`.
 * Layout: `0x01 | iv (12) | tag (16) | ciphertext`. The version byte leaves room for a key rotation.
 */
const VERSION = 1;
const IV = 12;
const TAG = 16;

function key(): Buffer {
  const k = env().ENCRYPTION_KEY;
  if (!k) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Falta configurar ENCRYPTION_KEY en el servidor.");
  return Buffer.from(k, "base64");
}

export const canEncrypt = () => Boolean(env().ENCRYPTION_KEY);

export function seal(plain: string): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function open(sealed: Buffer | Uint8Array): string {
  const b = Buffer.from(sealed);
  if (b[0] !== VERSION || b.length < 1 + IV + TAG) throw new Error("secretbox: unknown format");
  const decipher = createDecipheriv("aes-256-gcm", key(), b.subarray(1, 1 + IV));
  decipher.setAuthTag(b.subarray(1 + IV, 1 + IV + TAG));
  return Buffer.concat([decipher.update(b.subarray(1 + IV + TAG)), decipher.final()]).toString("utf8");
}

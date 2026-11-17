import { isIP } from "node:net";

/**
 * The client IP from headers a trusted proxy controls, never from values a client can forge:
 *
 * - Behind Cloudflare (`TRUST_CF=true`): `CF-Connecting-IP`, set by Cloudflare and overwritten on every hop.
 * - Otherwise: the **last** `X-Forwarded-For` entry, the one Traefik appends with the peer it actually saw. Earlier
 *   entries come from the client and are ignored (v1 trusted the first one, which anyone can set).
 * - Then `X-Real-IP` (also set by Traefik), else unknown.
 */
export function clientIp(headers: Headers, trustCloudflare: boolean): string | null {
  const valid = (v: string | null | undefined) => {
    const ip = v?.trim();
    return ip && isIP(ip) ? ip : null;
  };
  if (trustCloudflare) {
    const cf = valid(headers.get("cf-connecting-ip"));
    if (cf) return cf;
  }
  const chain = headers.get("x-forwarded-for")?.split(",") ?? [];
  return valid(chain.at(-1)) ?? valid(headers.get("x-real-ip"));
}

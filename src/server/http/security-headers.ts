/**
 * Security headers (docs/v2/07). Static ones go on every response via next.config; the CSP needs a per-request
 * nonce, so `src/proxy.ts` builds it for pages.
 */

/** Same on every response (pages, API, static files). */
export const STATIC_SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // microphone for the stage-2 Sunday voice screen; everything else off
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/**
 * Strict CSP: scripts only with this request's nonce (`'strict-dynamic'` lets them load Next's chunks). Styles allow
 * inline because React renders `style` attributes and nonces can't cover attributes; style injection can't run code.
 * Stage 2 adds `https://sunday.lemydev.com` to `connect-src`.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

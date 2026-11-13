# 07 — Security and deploy

## Fixes over v1 (from the audit)
- **Origin check (CSRF):** for every state-changing request authenticated by session cookie, require `Origin` (or `Sec-Fetch-Site: same-origin`) to match `APP_ORIGIN`. Token-authenticated requests are exempt (no cookies). Keep cookies `HttpOnly; Secure; SameSite=Lax`.
- **Security headers** (Next middleware/proxy or `next.config` headers): `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`, and a **CSP** as strict as the app allows (`default-src 'self'`; scripts with nonces if feasible with Next 16, otherwise document why; `connect-src 'self'`; `img-src 'self' data: blob:`; `worker-src 'self'`). Stage 2 will add `https://sunday.lemydev.com` to `connect-src`.
- **Client IP:** use `CF-Connecting-IP` only when the request comes through Cloudflare (trust flag `TRUST_CF=true`); else the first hop Traefik sets. Never trust arbitrary `X-Forwarded-For` values.
- **Lockout DoS:** v1 had a global 20-failure lock that an attacker could trigger to lock Lemy out. Replace with: per-device and per-IP exponential lockout (5 failures → backoff up to 24 h), and a global counter that only adds delay/alerts (push notice "intentos de acceso fallidos") but never locks everyone. Passkey unlock and recovery codes still work during a PIN lockout of another device.
- **Audit pruning:** `auth_attempt` and `audit_event` older than 90 days deleted daily.
- **API tokens:** hashed, scoped, revocable, `last_used` tracking; token creation/revocation needs a recent PIN or passkey re-auth (≤ 5 min).
- **Rate limits:** auth endpoints (per IP + device), token API (see `04`), push action endpoint.
- **Secrets:** env only; `ENCRYPTION_KEY` for refresh token / iCal URLs; never logged. Logger redacts `authorization`, `cookie`, tokens.
- **Dependencies:** `pnpm audit` in CI; Renovate/Dependabot optional.

## Fresh start consequences
- New VAPID keys → devices must re-subscribe (button in Ajustes; prompt on first open).
- New DB → setup flow again (`SETUP_CODE`), re-create PIN, re-register passkeys, new recovery codes.
- **Service worker:** v1 used cache name `agenda-v2` (confusing). v2 uses `agenda-<APP_VERSION>`; on `activate`, delete every cache that isn't the current one (including `agenda-v2`), `clients.claim()`. Ship with `skipWaiting` + an "actualizar" toast. Lemy should still clear site data once on each device at cutover.

## Environment variables (v2)
`DATABASE_URL`, `APP_ORIGIN=https://agenda.lemydev.com`, `TZ=America/Buenos_Aires`, `SESSION_SECRET`, `SETUP_CODE`, `WEBAUTHN_RP_ID=agenda.lemydev.com`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CORS_ALLOWED_ORIGINS=https://sunday.lemydev.com`, `TRUST_CF`, `PIN_REAUTH_DAYS=7`, `DEVICE_TRUST_DAYS=90`, `APP_VERSION`, `DISABLE_WORKER`, `SKIP_MIGRATIONS`, `LOG_LEVEL`.
Removed: `AGENT_TOKEN_HASH`, `AGENT_WEBHOOK_*`, Agenbot-related vars, `SLEEP_REMINDER_TIME` (becomes a normal recurring reminder). Review `INTERNAL_TOKEN` (keep only if an internal endpoint still needs it).
Validate env at boot with Zod; fail fast with a clear message (without printing values).

## Deploy (Coolify)
- Project `agenda`, application from this GitHub repo, branch `v2` until cutover then `main`. Dockerfile build (multi-stage, node:26-alpine, arm64), standalone output.
- **Single replica** (in-process worker + in-memory rate limits). Document it in the Coolify resource description.
- `docker/entrypoint.sh`: run migrations (unless `SKIP_MIGRATIONS`), then start. Healthcheck `GET /api/health` (DB ping + worker heartbeat age).
- Domain `https://agenda.lemydev.com`, Cloudflare DNS. Postgres via the internal hostname of `postgres-core` (shared instance from the sunday repo), DB `agenda`.
- Backups are handled at the Postgres level (sunday repo). Add a note in `docs/v2/runbooks/restore.md` on restoring just the `agenda` DB.
- Memory limit ~512 MB–1 GB.

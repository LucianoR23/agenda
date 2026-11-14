# Runbook — deploy agenda v2 on Coolify

First deploy runs from branch **`v2`**; at cutover (phase 9) the app switches to `main`. One container, **one
replica** (the worker and the rate limits live in memory).

## 0. Prerequisites

- `postgres-core` is running in the Coolify project `core` (image `pgvector/pgvector:pg18-trixie`, provisioned by the
  sunday repo).
- Docker image builds for `linux/arm64` (CI checks it on every push).

## 1. Database `agenda` (once)

Run on `postgres-core` as its admin user (Coolify → `postgres-core` → Terminal → `psql -U postgres`). Generate the
password on your machine and paste it only here and in the app's `DATABASE_URL`:

```sql
CREATE ROLE agenda LOGIN PASSWORD '<generated password>';
CREATE DATABASE agenda OWNER agenda;
\c agenda
-- the app's migration creates pg_trgm and unaccent; both are "trusted", so the owner can, but be explicit:
GRANT CREATE ON DATABASE agenda TO agenda;
```

Generate the password with `openssl rand -base64 24 | tr -d '/+='` (URL-safe, so it can go straight into the URL).

## 2. Application

Coolify → project **agenda** → New resource → **Public/Private GitHub repository** `LucianoR23/agenda`:

| Setting | Value |
|---|---|
| Branch | `v2` |
| Build pack | **Dockerfile** (repo root) |
| Port | `3000` |
| Domain | `https://agenda.lemydev.com` (Cloudflare DNS → the VPS; Traefik issues the certificate) |
| Healthcheck | path `/api/health`, port `3000` (the image also has a Docker HEALTHCHECK) |
| Replicas | **1** — write "single replica: in-process worker + in-memory rate limits" in the resource description |
| Memory limit | 512 MB – 1 GB |
| Build args | `APP_VERSION` = the commit SHA (Coolify's `SOURCE_COMMIT`), shown in Ajustes → Acerca de |

## 3. Environment variables

Mark every secret as **secret** in Coolify. Never paste them anywhere else.

| Variable | Value | How |
|---|---|---|
| `DATABASE_URL` | `postgres://agenda:<password>@postgres-core:5432/agenda` | internal hostname of postgres-core |
| `APP_ORIGIN` | `https://agenda.lemydev.com` | must be https in production |
| `WEBAUTHN_RP_ID` | `agenda.lemydev.com` | passkeys are bound to it |
| `TZ` | `America/Buenos_Aires` | process zone (the user's zone is a setting in the app) |
| `SESSION_SECRET` | 32+ random bytes | `openssl rand -base64 32` |
| `SETUP_CODE` | 8+ chars, typed once on the first-run screen | `openssl rand -hex 8` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | required for reminders (all three or none) | `npx web-push generate-vapid-keys`; subject `mailto:…`. New keys = every device subscribes again (Ajustes → Notificaciones) |
| `ENCRYPTION_KEY` | phase 6 | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | phase 6 | Google Cloud console (see `06`) |
| `CORS_ALLOWED_ORIGINS` | `https://sunday.lemydev.com` | phase 8 |
| `TRUST_CF` | `true` if the domain is proxied by Cloudflare (orange cloud), else `false` | client IP for lockout/audit |
| `PIN_REAUTH_DAYS` / `DEVICE_TRUST_DAYS` | `7` / `90` | defaults |
| `LOG_LEVEL` | `info` | |

`APP_VERSION`, `DISABLE_WORKER` and `SKIP_MIGRATIONS` stay unset (defaults). A missing or malformed variable stops
the container at boot with a message naming the variable (never its value): check the deployment logs.

## 4. Deploy

Deploy from Coolify. The entrypoint applies migrations (`0000` schema, `0001` search/triggers/Inbox seed), then starts
Next. Logs are JSON lines; the first ones should be `migrations applied` and `agenda starting`.

## 5. Verify

```bash
curl -s https://agenda.lemydev.com/api/health            # {"status":"ok","db":"ok","version":"<sha>",…}
curl -sI https://agenda.lemydev.com/ | grep -i -E "content-security-policy|strict-transport|x-frame"
```

Then on the phone: open `https://agenda.lemydev.com` → Configurar Agenda (the `SETUP_CODE`) → PIN → **save the 10
recovery codes** → Ajustes → Seguridad → huella → Ajustes → Notificaciones → activar → **Probar notificación**. Install
the PWA (Chrome menu → Instalar app) so notifications and their Listo / Posponer buttons work in the background. Do
the same on the laptop with the PIN (new device).

## 6. Rollback

Coolify → Deployments → redeploy the previous one. Migrations are forward-only; before phase 9 the database holds only
v2 data, so restoring the latest backup is the fallback (see `restore.md`).

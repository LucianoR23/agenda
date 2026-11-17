# Runbook — first deploy of agenda on Coolify

Everything from zero, in order. Nothing here is assumed done: each step says how to check it and what to do if it's
missing. Deploys come from branch **`main`** (after the phase 9 merge). One container, **one replica** (the worker and
the token rate limits live in memory).

Time: about an hour the first time, plus DNS propagation.

What you need at hand: access to the Coolify dashboard, the Cloudflare dashboard for `lemydev.com`, GitHub
(`LucianoR23/agenda`), and this repo cloned on your machine with `pnpm install` done (for `pnpm secrets:gen`).

---

## 0. Check the ground

| Check | How | If not |
|---|---|---|
| The v2 merge is on `main` | GitHub → `LucianoR23/agenda` → branch `main` shows `docs/v2/` and `openapi.sunday.yaml`; the last CI run on `main` is green | Merge the phase 9 PR first |
| The server is arm64 | Coolify → Servers → your server → Terminal: `uname -m` → `aarch64` | `x86_64` works too (the image builds for both); nothing changes below |
| The server has room | same terminal: `free -h` (≥ 1 GB available), `df -h /` (≥ 5 GB free) | Free space (`docker system prune` removes unused images) |
| Coolify can pull from GitHub | Coolify → **Sources**: a GitHub App connected to your account with access to `agenda` | §4.1 |
| `postgres-core` exists and runs | Coolify → project **agenda** → resource `postgres-core`, status **Running** (green) | §1.1 |

---

## 1. Postgres

### 1.1 `postgres-core` (already in the project `agenda`: check, don't recreate)

Open Coolify → project **agenda** → `postgres-core` and check, without changing anything:

- **Image:** `pgvector/pgvector:pg18-trixie` (General tab). The same instance will host Sunday's database later.
- **Status:** Running. If it's stopped: **Start** and wait for green.
- **Make it publicly available:** **off**. The app reaches it through Docker's internal network; it must not be
  exposed on the internet.
- **Postgres URL (internal):** shown on the General tab, like `postgres://postgres:…@<container-name>:5432/postgres`.
  Note the **host part** (`<container-name>`, a long id): it goes into `DATABASE_URL`. Don't copy the password
  anywhere; you won't need the admin password in the app.
- **Destination / network** (General → "Destination", or the Network section): note it (usually the server's default
  network `coolify`). The app must be on the same one (§4.2).

Only if it doesn't exist at all: project **agenda** → **+ New** → **Database** → **PostgreSQL** → image
`pgvector/pgvector:pg18-trixie`, name `postgres-core`, public access off → **Start**.

### 1.2 The `agenda` database and role (once)

First generate the secrets for the whole deploy, on your machine, in the repo:

```sh
pnpm secrets:gen
```

It prints `AGENDA_DB_PASSWORD` plus the app secrets of §5. Keep that terminal open while you deploy; don't save the
output to a file, a note or a chat. (Running it again gives new values: use only one set.)

Then Coolify → `postgres-core` → **Terminal** → connect:

```sh
psql -U postgres
```

(If Coolify set another admin user, it's on the General tab as "Username".) Run, pasting the generated
`AGENDA_DB_PASSWORD` in place of `<password>`:

```sql
CREATE ROLE agenda LOGIN PASSWORD '<password>';
CREATE DATABASE agenda OWNER agenda;
\c agenda
GRANT CREATE ON DATABASE agenda TO agenda;
-- the app's first migration creates these two; creating them here as admin avoids any permission surprise
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
\q
```

Check it:

```sh
psql -U agenda -d agenda -h 127.0.0.1 -c "select current_user, current_database();"
```

It asks for the password and answers `agenda | agenda`. If it says the role or database already exists, they were
created before: run only the `\c agenda` block and check that you know the role's password (if not:
`ALTER ROLE agenda PASSWORD '<password>';`).

---

## 2. DNS (Cloudflare)

Cloudflare → `lemydev.com` → **DNS → Records**:

1. Is there an `agenda` record already? If it points somewhere old, edit it; otherwise **Add record**.
2. Type **A** (or AAAA for IPv6), name `agenda`, content = the **server's public IP** (Coolify → Servers → your server
   → IP; or `curl -4 ifconfig.me` in the server terminal).
3. **Proxy status:**
   - **Proxied (orange cloud)** — recommended: hides the server IP. Then set `TRUST_CF=true` (§5) and check
     **SSL/TLS → Overview → mode = Full (strict)**. With "Flexible" you get an endless redirect loop.
   - **DNS only (grey cloud)**: then `TRUST_CF=false`.

Check from your machine: `nslookup agenda.lemydev.com` returns an IP (Cloudflare's if proxied, the server's if not).

---

## 3. Secrets (from `pnpm secrets:gen`)

| Variable | From |
|---|---|
| `SESSION_SECRET` | printed |
| `SETUP_CODE` | printed — you'll type it once on the phone (§8) |
| `ENCRYPTION_KEY` | printed — needed for Google Calendar/iCal; changing it later means reconnecting them |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | printed — new keys later = every device subscribes again |
| `AGENDA_DB_PASSWORD` | printed — used in §1.2 and inside `DATABASE_URL`, not as a variable of its own |

---

## 4. The application in Coolify

### 4.1 GitHub access (once)

Coolify → **Sources** → is there a GitHub App with access to `agenda`?

- **No:** **+ Add** → GitHub App → follow Coolify's flow (it creates the app on GitHub; choose your account, install it
  on **only** the `agenda` repository, or all if you'll deploy more repos). Back in Coolify the source shows as
  connected.
- This gives automatic deploys on every push/merge to `main`. (The repo is public, so "Public Repository" also works,
  but without the GitHub App you'd have to deploy by hand or set up a webhook.)

### 4.2 Create the resource

Coolify → project **agenda** → **+ New** → **Private Repository (with GitHub App)** → pick the source and
`LucianoR23/agenda`:

| Setting | Value |
|---|---|
| Branch | `main` |
| Build pack | **Dockerfile** (`/Dockerfile` at the repo root) |
| Name | `agenda` |
| Ports exposes | `3000` |
| Domains | `https://agenda.lemydev.com` (Coolify's proxy, Traefik, gets the certificate from Let's Encrypt) |
| Destination | the **same** one as `postgres-core` (§1.1) |

After creating it, in the resource's tabs:

- **General → Description:** `Single replica: in-process worker + in-memory rate limits.`
- **Advanced / Healthcheck:** enabled, path `/api/health`, port `3000`, method GET. (The image also has its own Docker
  HEALTHCHECK.)
- **Resource limits:** memory limit `768m` (512 MB minimum).
- **Replicas / scaling:** leave **1**.
- **Automatic deployment** on push: **on** (it's on by default with a GitHub App source).
- **Include Source Commit in Build:** **on** (General → Build, or Advanced, depending on the Coolify version). The
  build then gets `SOURCE_COMMIT` and the app's version becomes `<package.json version>+<short commit>` (e.g.
  `2.0.0+a9c942f`), shown in Ajustes → Acerca de and `/api/health`. Off, it's `2.0.0+build-<timestamp>`. Either
  way every deploy is a new version, so the service worker updates. Don't set `APP_VERSION` by hand: a fixed value
  would keep the service worker from updating between deploys.

### 4.3 Environment variables

Resource → **Environment Variables** → add each one (Developer view / "Normal view" → + Add). Turn **Is Secret on**
for every secret. None is a build variable.

Paste values bare: no quotes, no spaces around them (the app strips one pair of quotes and outer spaces, but keep
it clean). Leave optional variables out instead of empty. A Coolify shared-variable reference
(`{{environment.X}}`, `{{project.X}}`, `{{team.X}}`) only resolves if that shared variable exists at that level for
this app; otherwise the app receives the literal text and refuses to start, naming the variable.

| Variable | Value | Secret |
|---|---|---|
| `DATABASE_URL` | `postgres://agenda:<AGENDA_DB_PASSWORD>@<container-name>:5432/agenda` (host from §1.1) | yes |
| `APP_ORIGIN` | `https://agenda.lemydev.com` | no |
| `WEBAUTHN_RP_ID` | `agenda.lemydev.com` (passkeys are bound to it: don't change it later) | no |
| `TZ` | `America/Buenos_Aires` | no |
| `SESSION_SECRET` | from §3 | yes |
| `SETUP_CODE` | from §3 | yes |
| `VAPID_PUBLIC_KEY` | from §3 | yes |
| `VAPID_PRIVATE_KEY` | from §3 | yes |
| `VAPID_SUBJECT` | `mailto:` + your email (push services contact address) | no |
| `ENCRYPTION_KEY` | from §3 | yes |
| `CORS_ALLOWED_ORIGINS` | `https://sunday.lemydev.com` | no |
| `TRUST_CF` | `true` if the DNS record is proxied (orange), else `false` | no |
| `PIN_REAUTH_DAYS` | `7` | no |
| `DEVICE_TRUST_DAYS` | `90` | no |
| `LOG_LEVEL` | `info` | no |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | leave out for now; add them with [`google-oauth.md`](google-oauth.md) (§9) | yes |

Don't set `NODE_ENV`, `PORT`, `HOSTNAME`, `DISABLE_WORKER` or `SKIP_MIGRATIONS` (the image sets the right defaults).
`TEST_DATABASE_URL` never goes in production.

---

## 5. Deploy

Resource → **Deploy**. The first build takes a few minutes (it compiles Next and the native Argon2 addon for arm64).

In **Logs** / the deployment log, the build ends with the image tagged; then the container starts and its logs (JSON
lines) should show, in order:

1. `migrations applied` — `0000` schema, `0001` search/triggers/Inbox, `0002` settings, `0003` calendars, `0004` habit
   task tags.
2. `agenda starting` with `"worker": true`.

The resource turns **Running (healthy)** once `/api/health` answers.

---

## 6. Verify

From your machine:

```sh
curl -s https://agenda.lemydev.com/api/health
# {"status":"ok","db":"ok","version":"…","time":"…-03:00"}

curl -sI https://agenda.lemydev.com/ | grep -i -E "content-security-policy|strict-transport|x-frame|x-content-type"
# the four headers present

curl -s https://agenda.lemydev.com/api/openapi.sunday.json | head -c 120
# {"openapi":"3.1.0","info":{"title":"Agenda de Lemy",…
```

---

## 7. If something fails

| Symptom | Cause / fix |
|---|---|
| Container stops at boot with `Invalid environment:` and a list of variables | That variable is missing or malformed (the message names it, never the value). Fix it in §4.3 and redeploy. |
| `Invalid environment:` … `looks like an unresolved Coolify reference ({{…}})` | The shared variable that value points to doesn't exist in this app's environment (e.g. it was created in Sunday's). Create it where the reference says, or paste the value directly, and redeploy. |
| `Invalid option: expected one of "true"\|"1"\|…` | A flag (`TRUST_CF`, `DISABLE_WORKER`, …) has something other than true/false: check for stray characters, or delete it to use the default. |
| `ECONNREFUSED`, `getaddrinfo ENOTFOUND` or timeout on the database | `DATABASE_URL` host isn't `postgres-core`'s internal container name, or the app is on another Destination/network than `postgres-core` (§1.1, §4.2). |
| `password authentication failed for user "agenda"` | The password in `DATABASE_URL` differs from the role's: reset it with `ALTER ROLE agenda PASSWORD '…';` (§1.2) and update the variable. |
| `permission denied to create extension` | Run the two `CREATE EXTENSION` lines of §1.2 as `postgres` in the `agenda` database, then redeploy. |
| Browser: "too many redirects" | Cloudflare SSL mode is Flexible: set **Full (strict)** (§2). |
| 502 / 503 / "no available server" | The container isn't healthy yet or crashed: check its logs. Also check **Ports exposes = 3000**. |
| Certificate error right after creating the domain | Let's Encrypt needs the DNS record to resolve first; wait a few minutes and redeploy. With the orange cloud, Cloudflare serves its own certificate in front. |
| Build fails at `pnpm install` / Argon2 | Retry once (network); if it persists, copy the build log for debugging. |

---

## 8. First run on your devices

**Phone (Android, Chrome):**

1. If you ever opened an older agenda at this address: Chrome → ⋮ → Settings → Site settings → All sites →
   `agenda.lemydev.com` → **Clear & reset** (removes old caches and the old service worker).
2. Open `https://agenda.lemydev.com` → **Configurar Agenda** → type the `SETUP_CODE` → choose a 6-digit PIN → repeat.
3. **Save the 10 recovery codes** (password manager or paper). They are the way back if you lose the PIN and the
   fingerprint; they're shown once.
4. Chrome → ⋮ → **Install app** (needed so notifications and their Listo / Posponer buttons work in the background).
5. In the installed app: **Ajustes → Seguridad → Desbloquear con huella** (passkey); **Ajustes → Notificaciones en este
   dispositivo** → on → allow → **Probar notificación**: it must arrive.
6. Quick check: create a reminder for 2 minutes from now and wait for it, with the app closed.

**Laptop:** open the address → it's a new device → PIN (and optionally passkey/notifications there too). Ajustes →
Seguridad lists both devices.

Once both are set up you no longer need `SETUP_CODE` (setup only works once), but keep it in Coolify.

---

## 9. Google Calendar (optional, any time)

Follow [`google-oauth.md`](google-oauth.md): create the OAuth client, add `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` (§4.3), redeploy, then Ajustes → Calendario → Conectar Google. Plan B without Google Cloud:
the secret iCal address of each calendar (same runbook, §5).

## 10. Sunday

When the deploy is verified: [`sunday-tool-server.md`](sunday-tool-server.md) (token + register the tool server), and
hand [`../sunday-integration.md`](../sunday-integration.md) to the Sunday repo.

## 11. Rollback

Coolify → resource → **Deployments** → pick the previous successful one → **Redeploy**. Migrations are forward-only:
if a deploy applied a migration and the old code can't live with it, restore the database (see
[`restore.md`](restore.md)) from a dump taken before the deploy. Until scheduled backups are configured (pending),
take a manual dump before risky deploys (`restore.md` → "Take a dump").

## Pending

- **Scheduled backups** of `postgres-core` (Coolify → `postgres-core` → Backups). To decide: frequency, retention and
  whether they also go to S3/R2.

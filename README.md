# Agenda

Personal, single-user, mobile-first PWA to run my day. My AI assistant **Agenbot** reads my Google Calendars every
morning and loads the day plan through an HTTP API (two or more options, calls with lead context, the WhatsApp
checklist, gym/reading/dogs/sleep…). I choose an option, track it from my phone, and every change I make goes back to
Agenbot through a webhook.

- **Live:** https://agenda.lemydev.com · **Contract:** [`openapi.yaml`](openapi.yaml) (served at `/api/openapi.json`)
- **Stack:** Next.js 16 (App Router, React 19, TypeScript strict) · PostgreSQL 18 + Drizzle · Zod → OpenAPI 3.1 ·
  Tailwind v4 (Sistema Calma design) · TanStack Query + Dexie (offline) · motion + dnd-kit · Web Push · WebAuthn
- **Docs:** [decisions](docs/decisions.md) · [API examples](docs/api-examples.md) · [flows & state machines](docs/flows.md) ·
  [data model](docs/er.md) · [design](docs/design.md) · [screenshots](docs/ui-screenshots.md) · [test report](docs/test-report.md)

```
src/
  app/            routes: (app)/… screens, api/[...path] (single API dispatcher), manifest
  contract/       Zod schemas + route catalogue → openapi.yaml, docs/api-examples.md (source of truth)
  server/         db (Drizzle schema, migrations runner), http (router, idempotency, errors), auth, domain, jobs
  client/         fetch wrapper, IndexedDB cache + write outbox, queries
  ui/             design tokens, components, screens, PWA helpers
drizzle/          SQL migrations (committed)
scripts/          CLIs, OpenAPI/icon generators, agent-simulation.sh
tests/            unit, api (integration + contract), e2e (Playwright)
```

---

## Local development

Requirements: Node 24, pnpm 11 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env            # then fill SESSION_SECRET, SETUP_CODE, AGENT_TOKEN_HASH, INTERNAL_TOKEN…
pnpm db:up                      # Postgres 18: dev on :5433, test on :5434 (tmpfs)
pnpm db:migrate
pnpm db:seed --chosen           # optional: today's example day (2 options, calls, store shift, pádel…) + habits
pnpm dev                        # http://localhost:3000 (set APP_ORIGIN and WEBAUTHN_RP_ID=localhost)
```

| Command | What it does |
|---|---|
| `pnpm test` / `pnpm test:coverage` | Unit + API integration tests on the real Postgres test DB; every response is validated against `openapi.yaml` |
| `pnpm test:e2e` | Playwright on the production build (Android viewport), saves `docs/screenshots` |
| `pnpm openapi` / `openapi:check` / `openapi:lint` | Regenerate the contract and examples / CI drift check / Redocly |
| `pnpm db:generate --name x` | New migration from the Drizzle schema (commit the SQL) |
| `pnpm icons` / `pwa:icons` | Rebuild the icon sprite / the PWA PNG icons |
| `pnpm agent:simulate` | Agenbot's daily flow with curl (see [Agent integration](#agent-integration-guide)) |

## Agent token

```bash
pnpm agent:token
# Agent token (give to Agenbot, shown once):  Vs5cY8Dgsh…
# AGENT_TOKEN_HASH (env var):                 3fbf150e…
```

Only the SHA-256 hash is stored (`AGENT_TOKEN_HASH`). **Rotate:** run it again, put the new hash in Coolify, redeploy,
give Agenbot the new token. The old one stops working immediately.

## First-run setup

1. Open the app: it shows **Configurar Agenda** (only while no user exists).
2. Enter `SETUP_CODE`, choose a 6-digit PIN, repeat it.
3. Save the **10 recovery codes** (copy / download). They are shown once.
4. That browser is now a trusted device. Afterwards `/api/auth/setup` answers 404 forever.

Other devices log in with the PIN. A device unused for more than `PIN_REAUTH_DAYS` (7) asks again; in
**Ajustes → Seguridad** you can enable **Desbloquear con huella** per device, rename or revoke devices, change the PIN
and regenerate recovery codes. 5 wrong attempts lock that device for 15 min (doubling on each new lockout, max 24 h);
20 wrong attempts across devices lock everything.

## Forgot the PIN

- **Recovery code:** unlock screen → *Usar código de recuperación* → *Código de recuperación* → new PIN. The code is
  consumed; the app tells you how many remain.
- **Server code:** in the Coolify container terminal run `pnpm auth:reset-pin`. It prints an 8-digit code valid for
  15 minutes; use it in *Olvidé mi PIN → Código del servidor*.
- **New recovery codes:** `pnpm auth:recovery-codes` (invalidates the old ones) or from Ajustes → Seguridad.

---

## Deploy on Coolify (Oracle Cloud ARM64)

The repository ships a multi-stage [`Dockerfile`](Dockerfile) for **linux/arm64** (also builds on amd64). Coolify
builds it natively on the Ampere VPS. On start the container applies pending migrations (idempotent) and runs Next.js
(`output: "standalone"`); it also starts the in-process worker (webhook delivery, call and sleep reminders) — **run a
single replica**.

### 1. Database
1. **+ New → Database → PostgreSQL 18** in the same project/server. Don't expose it publicly.
2. Copy the **internal** connection URL (host is the resource's internal name, e.g.
   `postgres://agenda:…@agenda-db:5432/agenda`). That is `DATABASE_URL`.

### 2. Application
1. **+ New → Application → (Private) Git repository**, branch `main`, **Build pack: Dockerfile**.
2. **Network:** port `3000`. **Domain:** `https://agenda.lemydev.com`.
3. **Healthcheck:** enabled, path `/api/health`, port `3000` (the image also has a Docker `HEALTHCHECK`).
4. Optional build argument: `APP_VERSION` = commit SHA (shown in `/api/health`).
5. Migrations run on container start. If you prefer a **pre-deploy command**, set it to `pnpm db:migrate` and add
   `SKIP_MIGRATIONS=1`.

### 3. Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Internal Postgres URL from step 1 |
| `APP_ORIGIN` | `https://agenda.lemydev.com` (WebAuthn origin, webhook `dayUrl`) |
| `TZ` | `America/Buenos_Aires` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `SETUP_CODE` | Any secret string, used once on first run |
| `AGENT_TOKEN_HASH` | From `pnpm agent:token` |
| `INTERNAL_TOKEN` | `openssl rand -base64 24` (close-day task) |
| `WEBAUTHN_RP_ID` | `agenda.lemydev.com` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:you@yourdomain` |
| `AGENT_WEBHOOK_URL` / `AGENT_WEBHOOK_TOKEN` | Agenbot's endpoint and the bearer it expects (empty URL disables the webhook) |
| `WEBHOOK_DEBOUNCE_SECONDS` | `120` |
| `PIN_REAUTH_DAYS` / `DEVICE_TRUST_DAYS` | `7` / `90` |
| `SLEEP_REMINDER_TIME` | `10:00` (morning push when last night's sleep is incomplete) |

### 4. Cloudflare
DNS `agenda` → server IP, **proxied**. SSL/TLS mode **Full (strict)** (Coolify/Traefik issues the certificate). No
caching rules for `/api/*` (the API sends `Cache-Control: no-store`).

### 5. Close-day scheduled task
Application → **Scheduled Tasks → Add**:

- **Command:**
  ```sh
  wget -qO- --header="X-Internal-Token: $INTERNAL_TOKEN" --header="Content-Type: application/json" --post-data='{}' http://127.0.0.1:3000/api/internal/close-day
  ```
- **Frequency:** 00:05 Buenos Aires. Coolify cron runs in the server's time zone; on a UTC server use `5 3 * * *`
  (if the server runs in ART, `5 0 * * *`).

Missing a run never breaks history: any read of a past, unclosed day closes it first (lazy close).

### 6. Postgres backups to Cloudflare R2
1. Cloudflare → **R2 → Create bucket** (e.g. `agenda-backups`); **Manage API tokens → Create token** with *Object Read &
   Write* on that bucket. Note the Access Key ID, Secret and the S3 endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.
2. Coolify → **Settings → S3 Storages → Add**: endpoint above, region `auto`, bucket, keys → *Validate*.
3. Postgres resource → **Backups**: enable scheduled backups (e.g. daily `0 6 * * *`), select the R2 storage, keep e.g.
   30 backups. Test a restore once into a scratch database.

Also handy: **Ajustes → Exportar todo (JSON)** in the app.

### 7. First run in production
Open https://agenda.lemydev.com on the phone → setup (step above) → **Ajustes → Notificaciones** (allow push) →
**Seguridad → Desbloquear con huella** → in Chrome, *Instalar app*.

---

## Agent integration guide

Everything below is in the contract: `GET https://agenda.lemydev.com/api/openapi.json` (compact, ~115 KB;
`?examples=true` for the full document). Concrete requests/responses for every endpoint:
[`docs/api-examples.md`](docs/api-examples.md). `scripts/agent-simulation.sh` runs the whole flow with curl:

```bash
AGENT_TOKEN=… BASE_URL=https://agenda.lemydev.com DATE=2026-10-19 pnpm agent:simulate
```

### Basics
- `Authorization: Bearer <agent token>`. JSON only. Times are `America/Buenos_Aires`: dates `YYYY-MM-DD`, times `HH:mm`,
  timestamps ISO 8601 with offset.
- **Block times go up to `29:59`**: `24:15` = 00:15 of the next day, still part of the day it starts. `end < start`
  means it ends the next day (`23:30`→`07:00`).
- Unknown fields are rejected. Errors are RFC 9457 `application/problem+json` with a machine `code`.
- Send an **`Idempotency-Key`** on every POST/PUT/PATCH (retries replay the stored response; same key + different
  body → 422). Rate limit: 120 requests/min (429 + `Retry-After`).
- Optimistic concurrency: resources carry `version` (+ `ETag`); writes accept `If-Match` or `version` in the body;
  mismatch → 409 `version_conflict` with `current`.

### 07:00 sequence
1. `GET /api/agent/context?date=TODAY` — weekly gym vs target, habits pending today, streaks at risk, yesterday's
   completion and unfinished tasks, last review, last night's sleep, block types/hours I keep skipping, pending
   proposal.
2. Read both Google Calendars (read-only).
3. `PUT /api/days/TODAY` with `Idempotency-Key: agenbot-TODAY-0700`:
   - `options[]` (`A`, `B`, …), each with **all** calendar events (`source: "calendar"`, `externalId` = Google event id,
     `externalUrl`, `calendar: work|personal`) plus your blocks (`source: "agent"`).
   - Calls: `type: "call"`, `callKind: "closer" | "triage"` (tell them apart by the Google Calendar event),
     `title` = kind of call ("Llamada de cierre"), `lead: { name, phone?, whatsapp?, notes?, crmUrl? }`.
     Outcomes by kind — closer: `closed_won`, `follow_up`, `lost` (no cerrada), `not_qualified`, `no_show`,
     `rescheduled`; triage: `qualified`, `not_qualified`, `no_show`, `rescheduled` (else 422).
   - `tasks[]`: the checklist (`whatsapp_confirm`, `lead_context`, `follow_up`, `other`), optionally
     `relatedExternalId`. Applied immediately; your unfinished tasks are replaced, mine are never touched.
   - `callsSummary`, `weeklyGym`, `notes`, `reason` (shown when it becomes a proposal).
4. Handle the result: **201** created (draft) · **200** replaced (still draft) · **202** proposed (I had already chosen:
   nothing changed, I get a push and accept/reject) · **409 `day_closed`**.

### Ownership rules (why you get 409)

| What | Who owns it | You get |
|---|---|---|
| Schedule of calendar blocks (`start, end, title, type, detail, lead, order`) | Google Calendar (you mirror it) | — (I get `calendar_owned`) |
| Schedule fields I edited (`userOverrides`) | Me, until the day closes | `user_edit_conflict` unless `"force": true` (logged) |
| Anything on a `locked` block | Me | `user_edit_conflict`, even with `force` |
| `status`, `outcome`, `note` | Me; you may set them only while unset / `pending` | `user_edit_conflict` |
| `locked`, `remind`, my review, my tasks | Me | 403 / `user_edit_conflict` |
| A closed day | Me | `day_closed` |

On a re-plan (`PUT` on a chosen day) blocks are matched by `externalId`, then `id`, then (your blocks) type + title.
Matched blocks keep my tracking and my overrides; calendar events that disappeared are kept (marked
`removedFromCalendarAt`) if I already tracked them, deleted otherwise. Send `?mode=force` only when I ask you to apply
without asking.

### During the day
- **I changed an event in Google:** `PATCH /api/days/TODAY/blocks/by-external/{eventId}` with the new times → updated in
  every option.
- **"Ya fui al gym":** `PATCH /api/days/TODAY/blocks/{id}` `{"status":"done"}` (also logs the linked habit).
- **"Elegí la B":** `POST /api/days/TODAY/choose` `{"option":"B"}`.
- **"Anoche me dormí 00:20":** `POST /api/sleep/events` `{"type":"bed","at":"2026-10-20T00:20:00-03:00"}`.
- **"Me atrasé media hora":** `POST /api/days/TODAY/shift` `{"fromTime":"HH:mm","minutes":30}`.
- Habits: `POST /api/habits/{slug}/logs` `{"date","done","value?"}`. Tasks: `/api/tasks`.

### "Pedir ajuste" (I write what changed, you propose)
I describe a change in plain words from the app (Hoy → **+** → *Pedido a Agenbot*). You get an
`adjustment.requested` webhook **right away** (not debounced, never batched):

```json
{ "event": "adjustment.requested", "adjustmentId": "019a…", "date": "2026-10-19",
  "text": "Laura pasó a las 15:00 y me surgió algo de 17 a 18.", "createdAt": "2026-10-19T12:20:04.118-03:00",
  "adjustmentUrl": "https://agenda.lemydev.com/api/adjustments/019a…", "dayUrl": "https://agenda.lemydev.com/api/days/2026-10-19" }
```

1. `GET dayUrl` (and your calendars), build the rearranged day.
2. `PUT /api/days/{date}` with the full body plus `"adjustmentIds": ["019a…"]` → **202** proposal; the request becomes
   `proposed` and I get a push "Tu ajuste está listo". One PUT can answer several pending requests (there is only one
   pending proposal per day: a newer one supersedes the previous). On a **draft** day the PUT applies directly (200)
   and the request stays `pending`.
3. Close it: `PATCH /api/adjustments/{id}` `{"status":"done","agentNote":"Moví a Laura a las 15:00 y el gym a las 17:30."}`
   or `{"status":"failed","agentNote":"<why>"}`. A resolved or cancelled request → 409 `adjustment_resolved`.
4. I accept or reject the proposal in the app; the accept/reject webhook change carries `adjustmentIds`.

`adjustment.cancelled` (same shape + `cancelledAt`) means I cancelled it while `pending`: stop working on it. Catch up
after downtime with `GET /api/adjustments?status=pending`. Your writes never trigger webhooks.

### Webhook (my changes → you)
`POST ${AGENT_WEBHOOK_URL}` with `Authorization: Bearer ${AGENT_WEBHOOK_TOKEN}` and `Idempotency-Key: <batchId>`:

```json
{
  "event": "day.updated_by_user",
  "batchId": "019a…",
  "date": "2026-10-19",
  "dayVersion": 4,
  "changes": [
    { "entity": "block", "id": "…", "action": "update",
      "fields": { "status": { "from": "pending", "to": "done" }, "outcome": { "from": null, "to": "follow_up" } },
      "block": { "title": "Llamada de cierre", "type": "call", "start": "10:00", "externalId": "4f2k…", "outcome": "follow_up" },
      "at": "2026-10-19T10:48:03.551-03:00" },
    { "entity": "day", "id": "…", "action": "shift",
      "shift": { "fromTime": "21:00", "minutes": 45, "blocks": [{ "id": "…", "title": "Dormir", "from": "23:30", "to": "24:15" }] },
      "at": "…" }
  ],
  "summary": { "blocksDone": 5, "blocksTotal": 12, "weeklyGym": { "done": 2, "target": 3 } },
  "dayUrl": "https://agenda.lemydev.com/api/days/2026-10-19"
}
```

- Only **my** changes (yours never come back: no loops). Entities: `day` (choose, shift, review…), `block`, `task`,
  `habit_log`, `proposal` (accept/reject), `sleep_log`. "Pedir ajuste" requests arrive as separate
  `adjustment.requested` / `adjustment.cancelled` events (see above), with the same URL, auth and retries.
- Debounced per day: sent 120 s after my last change; `choose`, proposal accept/reject and adjustment events are sent
  immediately.
- Answer any 2xx. Failures are retried 30 s · 2 min · 8 min · 32 min with the **same** `Idempotency-Key`, then marked
  failed (visible in Ajustes → Agenbot). `GET dayUrl` if you need the full day.

## License
Private project.

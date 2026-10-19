# Prompt for Claude Code — "Agenda" (personal day-planner PWA fed by an AI agent)

## 0. Context

Build a personal, single-user, mobile-first PWA to organize my day, deployed at `https://agenda.lemydev.com`. I'm Luciano, a sales closer (high-ticket calls, fitness niche) who also works in person at my own store. My AI assistant **Agenbot** (Grok-based) reads my Google Calendars every day at 07:00 America/Buenos_Aires and today sends me the day plan as an image. Instead, it must load the plan into this app via an HTTP API, and I view, choose and track it from my phone (Samsung Galaxy S26 Ultra, Chrome on Android).

Key facts:
- One human user (me) + one machine client (Agenbot).
- **Google Calendar is the source of truth for scheduled events** (sales calls, pádel classes, in-person store shifts, meetings). I edit those in Google Calendar, never in the app. Agenbot only **reads** my calendars (one work calendar, one personal calendar) and never writes to them.
- Agenbot adds the rest of the plan around those events (gym, meals, reading, study, dogs, partner time, sleep, etc.), builds two or more plan options, the work checklist (WhatsApp confirmations, lead context) and the weekly gym count.
- Fixed timezone: `America/Buenos_Aires` (UTC-03:00, no DST). `date` = local `YYYY-MM-DD`; times = local `HH:mm`; timestamps = ISO 8601 with offset.
- UI language: Rioplatense Spanish. Code, identifiers, comments, API and docs: English.

## 1. Working agreement

Work in phases. **Stop at every ⛔ and wait for my approval** before continuing: show what you produced, list open questions, don't start the next phase.

- Use a task list; small conventional commits (`feat:`, `fix:`, `chore:`).
- The OpenAPI spec is the **source of truth** for the contract. Implementation and tests must match it; CI fails on drift.
- Don't invent requirements. If something is ambiguous, ask at the next ⛔, pick a sensible default meanwhile and record it in `docs/decisions.md`.
- Never commit secrets. Every secret comes from env vars; `.env.example` holds placeholders only.

## 2. Stack (decided)

- Next.js 16 (App Router, React 19, TypeScript strict), Route Handlers under `/api`, `output: "standalone"`.
- PostgreSQL 18 + Drizzle ORM + drizzle-kit migrations (SQL files committed).
- Zod for all validation; OpenAPI 3.1 generated from the Zod schemas (`@asteasolutions/zod-to-openapi` or equivalent) into `openapi.yaml`, committed and served at `/api/openapi.json`.
- Tailwind CSS v4; `@dnd-kit` for drag & drop; `motion` for swipe gestures; TanStack Query for server state; Dexie (IndexedDB) for offline cache + write outbox.
- PWA: Serwist (or a hand-written service worker if Serwist conflicts with the Next 16 build). Web Push via `web-push` + VAPID.
- Auth: Argon2id (`@node-rs/argon2`) for PIN and recovery codes; `@simplewebauthn/server` + `@simplewebauthn/browser` for the fingerprint passkey.
- Tests: Vitest (unit + API integration against a real Postgres via docker-compose test DB or Testcontainers), Playwright for mobile E2E (Android Chrome viewport).
- Package manager: pnpm.

## 3. Deployment (Coolify) and network surface

- Self-hosted **Coolify** on an Oracle Cloud **ARM64** VPS, Traefik reverse proxy, Cloudflare DNS (proxied).
- Postgres is a Coolify resource on the same server; the app reaches it **only through the internal Docker network** (`DATABASE_URL` uses the internal hostname). Postgres is never exposed publicly.
- Multi-stage `Dockerfile` building for `linux/arm64`. Migrations run idempotently on container start (or as Coolify pre-deploy command).
- Public (HTTPS, `agenda.lemydev.com`):
  - App routes → the PWA (session auth).
  - `/api/*` → Agenbot (Bearer token) or me (session cookie).
  - `/api/health` → unauthenticated liveness/readiness (checks DB), for the Coolify healthcheck.
  - `/api/openapi.json` → unauthenticated, so Agenbot can read the contract.
- Secret-protected internal endpoint:
  - `POST /api/internal/close-day` with header `X-Internal-Token`, called by a Coolify Scheduled Task at 00:05 ART. Also implement **lazy closing**: any read of a past day that is not `closed` closes it first, so a missed cron never breaks history.
- Outbound: webhook POST to Agenbot (see §6).
- Cloudflare R2: not used in the MVP. In the README, document pointing Coolify's Postgres S3 backups at an R2 bucket.
- Env vars (all documented in `.env.example`, placeholders only):
  `DATABASE_URL`, `APP_ORIGIN=https://agenda.lemydev.com`, `TZ=America/Buenos_Aires`, `SESSION_SECRET`, `SETUP_CODE`, `AGENT_TOKEN_HASH`, `INTERNAL_TOKEN`, `WEBAUTHN_RP_ID=agenda.lemydev.com`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `AGENT_WEBHOOK_URL`, `AGENT_WEBHOOK_TOKEN`, `WEBHOOK_DEBOUNCE_SECONDS=120`, `PIN_REAUTH_DAYS=7`, `DEVICE_TRUST_DAYS=90`.

## 4. Authentication (me)

Single user; there is **no sign-up form and no email**.

1. **First-run setup**: while no user exists, the app shows a setup screen that requires `SETUP_CODE` (from env). There I set a 6-digit PIN. The app then shows **10 single-use recovery codes** once (hashed with Argon2id, download/copy prompt). After setup, the setup route returns 404 forever.
2. **PIN**: 6 digits, stored as Argon2id hash. Brute-force protection: after 5 failed attempts lock for 15 min, doubling on each subsequent lockout (cap 24 h); lockout state persisted in DB, keyed per device and globally.
3. **Trusted devices**: on successful login the device gets a long-lived, httpOnly, Secure, SameSite=Lax session cookie tied to a `Device` row (name from user agent, last seen). The PIN (or fingerprint) is required again only if the device has been unused for more than `PIN_REAUTH_DAYS` (7), on a new device, or after revocation. Sliding expiry up to `DEVICE_TRUST_DAYS`.
4. **Fingerprint (optional, per device)**: in Settings I can enable "Desbloquear con huella", which registers a WebAuthn platform passkey (`authenticatorAttachment: "platform"`, `userVerification: "required"`). When enabled on that device, the unlock screen offers fingerprint first, with PIN as fallback.
5. **Forgot PIN**, two paths, both without email:
   - Enter one recovery code → set a new PIN (the code is consumed; show remaining count).
   - Server CLI: `pnpm auth:reset-pin` (runnable from the Coolify container terminal) prints a one-time reset code valid 15 min; entering it in the app lets me set a new PIN. `pnpm auth:recovery-codes` regenerates recovery codes (invalidating the old ones).
6. Settings → **Dispositivos**: list trusted devices, revoke any, rename.

## 5. Data model

UUIDv7 ids. Every mutable row has `createdAt`, `updatedAt`, `version` (int, +1 on every write) and `updatedBy` (`agent | user | system`).

- **Day**: `date` (unique), `status` (`draft | chosen | edited | closed`), `chosenOptionId?`, `notes?`, `callsSummary?`, `weeklyGym?` (`{ done, target }` as reported by the agent), `review?` (`{ energy 1-5, mood 1-5, text? }`), `version`.
- **PlanOption**: `dayId`, `label` (`A`, `B`, … unique per day), `title`, `description`, `order`.
- **Block**: `optionId`, `start` (`HH:mm`), `end?`, `title`, `type` (`call | meeting | routine | gym | meal | reading | study | dogs | partner | sleep | local_work | padel | other`), `detail?`, `lead?` (`{ name, phone?, whatsapp?, notes?, crmUrl? }`, only for `call`), `source` (`calendar | agent | user`), `externalId?` (Google event id, required when `source=calendar`), `externalUrl?` (Google Calendar event link), `calendar?` (`work | personal`), `status` (`pending | done | skipped`), `outcome?` (only `call`: `closed_won | follow_up | no_show | rescheduled | lost`), `note?`, `locked` (bool), `userOverrides` (string[] of schedule fields I edited), `order`, `version`.
- **Habit**: `name`, `kind` (`boolean | numeric`), `unit?`, `targetCount`, `targetPeriod` (`day | week`), `active`, `order`.
- **HabitLog**: `habitId`, `date`, `done`, `value?`, `source` (`agent | user`). Unique `(habitId, date)`.
- **Task**: `date`, `title`, `kind` (`whatsapp_confirm | lead_context | follow_up | other`), `origin` (`agent | user`), `done`, `relatedBlockId?`, `order`, `version`.
- **Proposal**: `dayId`, `payload` (full Day body), `reason?`, `status` (`pending | accepted | rejected | superseded`), `createdAt`.
- **ChangeLog**: `actor`, `entity`, `entityId`, `date`, `action` (`create | update | delete | replace | choose | close | propose | accept | reject`), `diff` (before/after), `requestId`, `at`.
- **WebhookOutbox**: `payload`, `status` (`pending | sent | failed`), `attempts`, `nextAttemptAt`, `lastError?`.
- **User** (single row): `pinHash`, `createdAt`. **RecoveryCode**: `hash`, `usedAt?`. **Device**: `name`, `sessionHash`, `lastSeenAt`, `lastUnlockAt`, `revokedAt?`. **Passkey**: `deviceId`, `credentialId`, `publicKey`, `counter`, `transports`. **AuthAttempt/Lockout**. **PushSubscription**: `deviceId`, `endpoint`, `keys`. **IdempotencyKey**: `key`, `actor`, `requestHash`, `responseStatus`, `responseBody`, `createdAt` (TTL 48 h).

⛔ **STOP 1**: show the Drizzle schema, generated SQL migration, Mermaid ER diagram and `docs/decisions.md`.

## 6. API contract

### General rules
- JSON only, base `/api`. Auth: `Authorization: Bearer <agent token>` (Agenbot) or session cookie (me). Actor (`agent | user`) is derived from the auth method.
- Agent token: random 32 bytes, stored only as SHA-256 hash in `AGENT_TOKEN_HASH`. `pnpm agent:token` prints a new token + hash.
- Strict validation (unknown fields rejected). Errors as RFC 9457 problem+json: `{ type, title, status, detail, code?, errors: [{ path, message }], requestId }`.
- Optimistic concurrency: resources return `version` and `ETag`; writes accept `If-Match` or `version` in the body; mismatch → `409 version_conflict` with the current resource.
- `Idempotency-Key` supported on all POST/PUT/PATCH (same key + same body → replay; different body → `422`).
- Agent rate limit 120 req/min → `429` + `Retry-After`.
- Every write creates a ChangeLog entry.

### Ownership and conflict rules (core of the design)
Block fields are split into **schedule fields** (`start, end, title, type, detail, lead, order`) and **tracking fields** (`status, outcome, note`).

1. **Calendar blocks** (`source=calendar`): schedule fields are owned by the agent, because Google Calendar is the source of truth. If I try to change them from the app → `409 calendar_owned` (the UI doesn't offer it; it shows "Editar en Google Calendar" opening `externalUrl`). The agent matches them by `externalId`.
2. **Agent/user blocks** (`source=agent|user`): I can edit anything. Each schedule field I edit is added to `userOverrides` and stays mine **until the day closes**. If the agent writes a field present in `userOverrides`, or any field of a `locked` block → `409 user_edit_conflict` with the current block, unless it sends `"force": true` (not allowed on `locked` blocks), which is logged.
3. **Tracking fields** are mine. The agent may set them only while they are unset/`pending` (e.g. I tell Agenbot "ya fui al gym" and it marks the block done). If I already set one → `409 user_edit_conflict`.
4. **Full replace** `PUT /api/days/{date}`:
   - Day in `draft` → replaced.
   - Day in `chosen | edited` → **not overwritten**: creates a `Proposal` (`202 Accepted`), supersedes any previous pending proposal, sends me a push. I accept or reject in the app. On accept, blocks are matched (by `externalId`, then by `id`) and my tracking fields and `userOverrides` are preserved.
   - `?mode=force` applies immediately with the same preservation rules (logged).
   - Day `closed` → `409 day_closed` for the agent. I can still edit closed days.

### Webhook to Agenbot (outbound)
- When **I** change something (block status/outcome/edits, choosing an option, accepting/rejecting a proposal, tasks, habit logs, review), enqueue the change. Changes made by the agent never trigger the webhook (no loops).
- Debounce: send one aggregated POST after `WEBHOOK_DEBOUNCE_SECONDS` (120) without new changes, or immediately for `choose` and `proposal.accepted|rejected`.
- `POST ${AGENT_WEBHOOK_URL}` with headers `Authorization: Bearer ${AGENT_WEBHOOK_TOKEN}`, `Content-Type: application/json`, `Idempotency-Key: <batch id>`.
- Body:
  ```json
  {
    "event": "day.updated_by_user",
    "batchId": "uuid",
    "date": "2026-10-19",
    "dayVersion": 12,
    "changes": [
      { "entity": "block", "id": "uuid", "action": "update",
        "fields": { "status": { "from": "pending", "to": "done" } },
        "block": { "title": "Gym", "type": "gym", "start": "18:00" } }
    ],
    "summary": { "blocksDone": 5, "blocksTotal": 12, "weeklyGym": { "done": 2, "target": 3 } },
    "dayUrl": "https://agenda.lemydev.com/api/days/2026-10-19"
  }
  ```
- Delivery via `WebhookOutbox`: retry with exponential backoff (5 attempts), never block the user request. Show last delivery status in Settings.

### Endpoints
```
GET    /api/health
GET    /api/openapi.json
GET    /api/days/{date}                     full day: options, blocks, tasks, habit logs, pending proposal
PUT    /api/days/{date}                     create/replace whole day (rules above) — idempotent
PATCH  /api/days/{date}                     notes, callsSummary, weeklyGym, review, limited status transitions
POST   /api/days/{date}/choose              { "option": "A" } → status chosen
POST   /api/days/{date}/shift               { "fromTime": "HH:mm", "minutes": 30 } shift my pending agent/user blocks
GET    /api/days/{date}/proposals
POST   /api/days/{date}/proposals/{id}/accept
POST   /api/days/{date}/proposals/{id}/reject
POST   /api/days/{date}/blocks              add block (to chosen option, or ?option=A)
PATCH  /api/days/{date}/blocks/{id}         edit block (ownership rules apply)
PATCH  /api/days/{date}/blocks/by-external/{externalId}   agent convenience for calendar blocks
DELETE /api/days/{date}/blocks/{id}
POST   /api/days/{date}/blocks/reorder      { "ids": [...] }
GET    /api/days?from=&to=                  summaries for history
GET    /api/habits                          with streak + current period progress
POST   /api/habits | PATCH /api/habits/{id}
GET    /api/habits/{id}/logs?from=&to=
POST   /api/habits/{id}/logs                upsert by date
GET    /api/tasks?date=&done=
POST   /api/tasks | PATCH /api/tasks/{id} | DELETE /api/tasks/{id}
GET    /api/metrics?range=week|month&anchor=YYYY-MM-DD
GET    /api/agent/context?date=             compact planning context for the agent
GET    /api/changelog?from=&to=&actor=
POST   /api/push/subscribe | DELETE /api/push/subscribe
POST   /api/internal/close-day              X-Internal-Token only
Auth (session only): /api/auth/setup, /api/auth/unlock, /api/auth/recover,
  /api/auth/passkey/register/{options,verify}, /api/auth/passkey/auth/{options,verify},
  /api/auth/devices (GET, PATCH, DELETE), /api/auth/logout
```

`GET /api/agent/context` returns in one call: this week's gym count vs target, habits pending today, streaks at risk, yesterday's completion %, yesterday's unfinished tasks, my last end-of-day review, and agent block types/times I've systematically skipped in the last 14 days.

Metrics: gym sessions/week, reading days, % blocks done (overall and by type), calls per day, call outcomes (show-up rate, close rate), habit streaks.

⛔ **STOP 2**: show `openapi.yaml`, an example request/response for every endpoint (especially Agenbot's 07:00 `PUT` with calendar + agent blocks and two options), a sequence diagram of: 07:00 load → I choose → I mark blocks → webhook → agent replaces day → proposal → accept. Also the `Day.status` state machine.

## 7. Implementation — API

- Implement everything above.
- Tests (CI must pass): validation errors, idempotent PUT, version conflicts, `calendar_owned`, `userOverrides` conflicts, `locked`, tracking-field ownership, `force`, proposal create/supersede/accept/reject with preservation, closed-day protection, lazy close, close-day cron, idempotency replay, auth (agent / user / none), PIN lockout, recovery code consumption, reset-pin CLI code, device re-auth after 7 days, webhook debounce + no-loop + retry, metrics math with fixtures, midnight ART edge cases.
- Contract tests: validate every response against `openapi.yaml`.
- Seed: realistic day with 2 options, calendar calls with leads, pádel, store shift, gym, dogs, reading.

⛔ **STOP 3**: test report + a `scripts/agent-simulation.sh` (curl) reproducing Agenbot's daily flow.

## 8. Implementation — UI (mobile-first, Spanish)

Bottom tab bar: **Hoy · Tareas y hábitos · Historial · Métricas · Ajustes**.

- **Hoy**: vertical timeline, color per type (calls prominent with lead name), "now" line updated every minute, auto-scroll to now. Calendar blocks show a small calendar icon (work/personal). `draft`: horizontal swipe between options + sticky "Elegir esta". Pending proposal: banner "Agenbot propone un cambio" → diff view (added/removed/moved) → Aceptar / Rechazar.
- Gestures: swipe on the header to change day; swipe a block right = done, left = skipped (undo toast, haptic); long-press + drag to reorder/move **agent/user blocks only** (snap 15 min); tap opens the editor (calendar blocks: only tracking fields + "Editar en Google Calendar").
- Call blocks: "Llamar" (`tel:`), "WhatsApp" (`https://wa.me/...` with a prefilled confirmation message), outcome picker after the call.
- "Me atrasé": shift my pending agent/user blocks +15/+30/+60 min (calendar blocks untouched).
- Bottom-sheet block editor (time, end, title, type, detail, lock) + FAB to add a block.
- **Tareas y hábitos**: today's checklist grouped by kind; habits with streak and weekly ring (gym 2/3); numeric habits ask for a value.
- **Historial**: month calendar with completion-% heatmap; tap a day for a read-only timeline + review.
- **Métricas**: simple charts (gym/week, reading days, % done, calls/day, call outcomes, streaks).
- **Ajustes**: habits & targets; Seguridad (change PIN, enable fingerprint on this device, regenerate recovery codes, Dispositivos); notifications (push on/off, 10-min call reminder on/off); Agenbot (webhook last delivery status, token rotation instructions); export all data as JSON.
- **Cierre del día**: from 22:00 a card asks for the review (energy, mood, note) and lists pending blocks to resolve.
- Auth screens: setup, PIN keypad (with fingerprint button when enabled), recovery code entry.
- Dark mode following system, safe-area insets, 44 px targets, one-handed use.

PWA / offline:
- Installable (manifest, maskable icons, Android install prompt). App shell + last 14 days cached.
- Reads: IndexedDB first, revalidate. Writes: optimistic, queued in an outbox with `Idempotency-Key`, replayed on reconnect; on `409` show a conflict sheet (mine vs server), never silently overwrite.
- Offline indicator + "última sincronización hace X".
- Web Push: agent loaded/changed the plan, new proposal, optional reminder 10 min before each `call` block.

⛔ **STOP 4**: Playwright screenshots (Android viewport) of every view, including draft selector, proposal diff, PIN/fingerprint unlock.

## 9. Later (do NOT build unless I approve)

- Block attachments in Cloudflare R2 (presigned uploads).
- Weekly review generated by the agent.
- Focus timer for `study`/`reading` blocks that logs the habit.
- MCP server wrapping the API for Agenbot.

## 10. Deliverables

1. `docs/decisions.md`, folder structure.
2. Schema, migrations, seed.
3. API + tests + contract tests.
4. Mobile UI with all views, gestures and auth flows.
5. `openapi.yaml` (+ `/api/openapi.json`).
6. `README.md`: local dev (docker-compose with Postgres); generating the agent token; first-run setup; PIN recovery (codes and CLI); Coolify deploy step by step (resource, env vars, internal DB URL, healthcheck, domain `agenda.lemydev.com`, scheduled task for close-day, Postgres backups to R2); VAPID keys; **Agent integration guide** (07:00 call sequence, ownership/conflict rules, webhook payload).
7. `Dockerfile` (arm64) + `docker-compose.yml` for local dev.

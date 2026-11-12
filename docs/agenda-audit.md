# Agenda — read-only audit (for a from-scratch rewrite)

- **Audited:** 2026-11-12, `main` @ `6aa20e0` (22 commits, all 2026-10-19 → 2026-10-21), clean working tree.
- **Method:** read every config, the DB schema and migrations, the server (router, auth, domain, jobs), the client
  data layer, the service worker, and the UI screens. Ran `tsc --noEmit` and ESLint. Did **not** run the tests,
  because every test suite (unit included) goes through a global setup that connects to Postgres and drops its schema,
  and I was told not to connect to any database. Did not connect to any DB or external service.
- **Secrets:** none printed. `.env.example` has placeholders only. A scan of the tree and git history found no
  committed keys or `.env` files.

> **Short version:** this is a small (~12 k LOC of source), unusually disciplined, well-documented codebase: a
> contract-first API (Zod → OpenAPI 3.1, every test response validated against the spec), a single dispatcher with
> per-route auth, idempotency keys, optimistic concurrency, an offline-first client (IndexedDB cache plus a write
> outbox), solid PIN/WebAuthn auth, and a full design-token system. The **domain model** (day → options → blocks,
> proposals, Agenbot ownership rules, call outcomes, adjustments) is tied to the Agenbot/Grok workflow and is mostly
> **not** what the new direction needs. The **infrastructure patterns** are very reusable.

---

## 1. Stack & tooling

| Area | What's used (installed version) | Notes |
|---|---|---|
| Framework | **Next.js 16.4.2** (App Router, Turbopack, `output: "standalone"`, `cacheComponents: true`, `partialPrefetching: true`) | `AGENTS.md` warns that Next 16 APIs differ from older docs. Uses `instant = false` route segment config and `connection()` from `next/server`. |
| React | **19.3.0** / react-dom 19.3.0 | **React Compiler is NOT enabled** (no `reactCompiler` in `next.config.ts`, no babel plugin installed). 9 `useMemo`/`useCallback` uses in 3 files. |
| TypeScript | **5.9.3**, `strict: true`, `moduleResolution: bundler`, path alias `@/* → src/*` | |
| Node | **24** (Dockerfile `node:24-alpine`, CI `node-version: 24`; local v24.11.1) | |
| Package manager | **pnpm 11.17.0** (`packageManager` field, corepack) | Single package. `pnpm-workspace.yaml` exists only for `allowBuilds` (esbuild yes, sharp/unrs-resolver no). **No monorepo, no Turborepo.** |
| CSS | **Tailwind CSS 4.3.3**, CSS-first (`@import "tailwindcss"` + `@theme inline` in `src/app/globals.css`), loaded via `@tailwindcss/turbopack` rule | No `tailwind.config.*`. |
| Lint/format | **ESLint 9.39.5** flat config (`eslint-config-next` core-web-vitals + typescript) | **No Biome, no Prettier.** (Don't run `npx prettier`; it reformats everything at 80 cols.) |
| UI libraries | **None.** No shadcn, no Radix, no headless lib. Every component is hand-written in `src/ui/components/*` | `motion` 14.3.0 (gestures/animation), `@dnd-kit/core` 6.3.1 + `sortable` 10 (drag), Material Symbols as a **generated SVG sprite** (`public/icons.svg` from `@material-symbols/svg-400`). |
| DB / ORM | **PostgreSQL 18** · **drizzle-orm 0.45.4** · **drizzle-kit 0.31.11** · driver **postgres (postgres.js) 3.4.9** | `casing: "snake_case"`. PG18 `uuidv7()` used as the column default. |
| Validation | **zod 4.6.7** + `@asteasolutions/zod-to-openapi` 9.1.0 | Zod is the source of truth for the request/response contract. |
| Date/time | **No library.** Hand-rolled helpers in `src/server/time.ts` and `src/ui/time.ts` with a **hard-coded UTC−03:00 offset** | Works because Argentina has no DST. Not portable. |
| Server state | **@tanstack/react-query 5.104.4** | |
| Offline storage | **dexie 4.4.6** (IndexedDB) | Query cache plus write outbox. |
| Auth libs | `@node-rs/argon2` 2.2.2 (Argon2id), `@simplewebauthn/server` 14.0.3 / `browser` 14.0.0 | |
| Push | `web-push` 3.6.7 (VAPID) | |
| IDs | `uuidv7` npm (client-generated ids for offline creates) + PG `uuidv7()` | |
| Tests | vitest 5.0.5 (+ coverage-v8), @playwright/test 1.64.1, ajv 8 (+ formats) for contract checks | |
| Contract tooling | `@redocly/cli` 2.64.1 (`openapi:lint`), `scripts/openapi.ts` generator | |

---

## 2. Structure

### 2.1 Folder tree (depth 3; skipping node_modules, .next, screenshots, drizzle/meta, icon PNGs)

```
.
├── .github/workflows/ci.yml        # typecheck, lint, db:check, openapi:check/lint, icons:check, tests, e2e, arm64 docker build
├── Dockerfile                      # multi-stage node:24-alpine, arm64-first
├── docker/                         # runtime package.json + entrypoint.sh (migrate, then node server.js)
├── docker-compose.yml              # local Postgres 18: dev :5433, test :5434 (tmpfs)
├── design/Agenda - Sistema.dc.html # Claude Design export of the "Sistema Calma" design system (reference)
├── docs/                           # prompt.md (original spec), decisions.md (D1–D93), er.md, flows.md, design.md,
│                                   # api-examples.md (14.8k lines, generated), test-report.md, ui-screenshots.md, screenshots/
├── drizzle/                        # 0000–0008 SQL migrations + meta snapshots
├── openapi.yaml                    # generated OpenAPI 3.1 (775 KB with examples)
├── public/                         # sw.js (hand-written service worker), icons.svg sprite, icons/*, favicon.ico
├── scripts/                        # CLIs (agent-token, auth-reset-pin, auth-recovery-codes, seed), openapi/icons/pwa-icons generators,
│                                   # build-cli.mjs (esbuild → dist-cli), agent-simulation.sh, fixtures/agenbot-*.json
├── src/
│   ├── app/
│   │   ├── (app)/                  # screens: page (Hoy), tareas, historial, metricas, ajustes/{,habitos,opciones,seguridad}
│   │   ├── api/[...path]/route.ts  # single catch-all API dispatcher
│   │   ├── dev/design/page.tsx     # design gallery (404 in production)
│   │   ├── globals.css, layout.tsx, manifest.ts
│   ├── client/                     # api.ts (fetch wrapper), db.ts (Dexie), queries.ts (TanStack hooks), sync.ts (outbox), types.ts
│   ├── contract/                   # Zod schemas (planning, tracking, sleep, adjustments, system, common, problems),
│   │   └── routes/                 # route catalogue with paired request/response examples → openapi.yaml
│   ├── instrumentation.ts          # starts the in-process worker
│   ├── server/
│   │   ├── api/                    # handlers.ts: operationId → implementation
│   │   ├── auth/                   # auth.ts, cookies.ts, crypto.ts, lockout.ts, session.ts
│   │   ├── db/                     # client.ts, migrate.ts, schema/{auth,common,planning,sync,tracking}.ts
│   │   ├── domain/                 # days, blocks, merge, ownership, adjustments, tracking, insights, streaks, events, load, serialize
│   │   ├── http/                   # router.ts, context.ts, errors.ts, idempotency.ts, ratelimit.ts
│   │   ├── env.ts, jobs.ts, push.ts, time.ts, worker.ts
│   └── ui/
│       ├── components/             # block-card, controls, extensions, feedback, icon, navigation, overlay, page, pin-pad, surfaces, brand
│       ├── screens/                # auth, settings, security, habits-settings, options-history, history, metrics, tasks, today/*
│       ├── block-types.ts, cx.ts, format.ts, icons.ts, pwa.ts, shell.tsx, theme.ts, time.ts
└── tests/                          # unit/, api/ (10 files, real Postgres), e2e/ (Playwright, Android viewport), helpers/
```

### 2.2 Routes

**Pages** (App Router). All are thin wrappers that render a client screen. `(app)` segments set `export const instant = false`.

| Route | File | What it is |
|---|---|---|
| `/` (Hoy) | `src/app/(app)/page.tsx` → `ui/screens/today/today.tsx` | Day timeline: options, swipe done/skip, drag to move, block editor, proposals, "Me atrasé", sleep card, day review, Agenbot requests |
| `/tareas` | `(app)/tareas/page.tsx` → `ui/screens/tasks.tsx` | Today's tasks, grouped by kind, plus habit progress and streaks |
| `/historial` | `(app)/historial/page.tsx` → `ui/screens/history.tsx` | Month heat-map of completion; tap a day → summary sheet |
| `/metricas` | `(app)/metricas/page.tsx` → `ui/screens/metrics.tsx` | Week/Month/Year stats (blocks, gym, calls closer/triage, sleep, streaks) |
| `/ajustes` | `(app)/ajustes/page.tsx` → `ui/screens/settings.tsx` | Theme, push toggles, Agenbot webhook status, export JSON, install, about/update |
| `/ajustes/habitos` | → `ui/screens/habits-settings.tsx` | Habit CRUD (boolean/numeric, day/week target, link to block type) |
| `/ajustes/opciones` | → `ui/screens/options-history.tsx` | Chosen vs not-chosen options per day |
| `/ajustes/seguridad` | → `ui/screens/security.tsx` | Fingerprint toggle, change PIN, regenerate recovery codes, devices |
| `/dev/design` | `src/app/dev/design/page.tsx` | Component gallery; `notFound()` in production |
| `/manifest.webmanifest` | `src/app/manifest.ts` | PWA manifest |

**Layouts:** `src/app/layout.tsx` (fonts, metadata, inline theme boot script); `src/app/(app)/layout.tsx` wraps
everything in `AppShell` (`src/ui/shell.tsx`): IndexedDB hydrate, sync engine, auth gate (Setup / Unlock / Frame),
tab bar or sidebar, conflict sheet.

**Middleware / proxy:** none. **Server actions:** none. **Route handlers:** only `src/app/api/[...path]/route.ts`,
which exports GET/POST/PUT/PATCH/DELETE → `handle()` in `src/server/http/router.ts`. The router matches the request
against the contract catalogue (`src/contract/routes/*`): literal segments beat params, then auth, rate limit,
Zod validation, idempotency, one DB transaction per request, after-commit hooks, then problem+json errors.

**API endpoints (57 operations).** Access: `agent+user`, `user`, `agent`, `preauth` (session cookie optional),
`public`, `internal` (`X-Internal-Token`).

| Method | Path | operationId | Access |
|---|---|---|---|
| GET | /api/days?from&to | listDays | agent+user |
| GET | /api/days/{date} | getDay | agent+user |
| POST | /api/days/{date} | createOwnDay ("Armar mi día") | user |
| PUT | /api/days/{date}[?mode=force] | putDay (full plan load) | **agent** |
| PATCH | /api/days/{date} | patchDay (notes, review, close) | agent+user |
| POST | /api/days/{date}/choose | chooseOption | agent+user |
| POST | /api/days/{date}/shift | shiftDay ("Me atrasé") | agent+user |
| GET | /api/days/{date}/proposals | listProposals | agent+user |
| POST | /api/days/{date}/proposals/{id}/accept | acceptProposal | user |
| POST | /api/days/{date}/proposals/{id}/reject | rejectProposal | user |
| POST | /api/days/{date}/blocks[?option=] | createBlock | agent+user |
| PATCH | /api/days/{date}/blocks/{id} | patchBlock | agent+user |
| PATCH | /api/days/{date}/blocks/by-external/{externalId} | patchBlockByExternal (Google mirror) | **agent** |
| DELETE | /api/days/{date}/blocks/{id} | deleteBlock | agent+user |
| POST | /api/days/{date}/blocks/reorder | reorderBlocks | agent+user |
| POST | /api/adjustments | createAdjustment ("Pedir ajuste") | user |
| GET | /api/adjustments?date&status | listAdjustments | agent+user |
| GET | /api/adjustments/{id} | getAdjustment | agent+user |
| PATCH | /api/adjustments/{id} | patchAdjustment (done/failed + note) | **agent** |
| POST | /api/adjustments/{id}/cancel | cancelAdjustment | user |
| GET/POST | /api/habits | listHabits / createHabit | agent+user |
| PATCH | /api/habits/{idOrSlug} | patchHabit | agent+user |
| GET/POST | /api/habits/{idOrSlug}/logs | listHabitLogs / upsertHabitLog | agent+user |
| GET/POST | /api/tasks | listTasks / createTask | agent+user |
| PATCH/DELETE | /api/tasks/{id} | patchTask / deleteTask | agent+user |
| GET | /api/sleep?from&to | listSleep | agent+user |
| POST | /api/sleep/events | logSleepEvent (bed/wake) | agent+user |
| PUT | /api/sleep/{date} | upsertSleep | agent+user |
| GET | /api/metrics?range=week\|month\|year&anchor | getMetrics | agent+user |
| GET | /api/agent/context?date | getAgentContext | agent+user |
| GET | /api/changelog | listChangelog | agent+user |
| GET | /api/export | exportData (full JSON dump) | user |
| GET | /api/webhook/status | webhookStatus | user |
| POST/DELETE | /api/push/subscribe | pushSubscribe / pushUnsubscribe | user |
| GET | /api/auth/session | getSession | preauth |
| POST | /api/auth/setup | setup (first run only) | preauth |
| POST | /api/auth/unlock | unlock (PIN) | preauth |
| POST | /api/auth/recover | recover (recovery or reset code → new PIN) | preauth |
| POST | /api/auth/pin | changePin | user |
| POST | /api/auth/recovery-codes | regenerateRecoveryCodes | user |
| POST | /api/auth/passkey/register/options · /verify | passkeyRegister* | user |
| POST | /api/auth/passkey/auth/options · /verify | passkeyAuth* | preauth |
| DELETE | /api/auth/passkey | deletePasskey | user |
| GET | /api/auth/devices | listDevices | user |
| PATCH/DELETE | /api/auth/devices/{id} | renameDevice / revokeDevice | user |
| POST | /api/auth/logout | logout | user |
| GET | /api/health | health | public |
| GET | /api/openapi.json[?examples=true] | openapi | public |
| POST | /api/internal/close-day | closeDay (cron) | internal |

---

## 3. Data model

**Tooling:** Drizzle schema in `src/server/db/schema/*.ts` → `drizzle-kit generate` → SQL committed in `drizzle/`
(9 migrations; `0001` is hand-written triggers). Applied by `src/server/db/migrate.ts` (drizzle migrator, records
progress in the `drizzle.__drizzle_migrations` table). It runs on container start via `docker/entrypoint.sh` unless
`SKIP_MIGRATIONS=1`. CI runs `drizzle-kit check` (schema ↔ migrations in sync).

**Conventions:** UUIDv7 PKs (`DEFAULT uuidv7()`, PG18). Versioned rows (`version`, `updated_at`, `updated_by`) are
bumped **by triggers** (`bump_row_version`), so the app can't forget; optimistic concurrency is
`WHERE id=? AND version=?`. Times are stored as `text 'HH:mm'` with regex CHECKs (block times go up to `29:59` for
past midnight). Every closed vocabulary is a PG enum.

### 3.1 Effective DDL (consolidated final state after 0000–0008)

```sql
-- ===== enums =====
CREATE TYPE actor            AS ENUM ('agent','user','system');
CREATE TYPE block_source     AS ENUM ('calendar','agent','user');
CREATE TYPE block_status     AS ENUM ('pending','done','skipped');
CREATE TYPE block_type       AS ENUM ('call','meeting','routine','gym','meal','reading','study','dogs','partner','sleep','local_work','padel','other');
CREATE TYPE calendar_kind    AS ENUM ('work','personal');
CREATE TYPE call_outcome     AS ENUM ('closed_won','follow_up','no_show','rescheduled','lost','qualified','not_qualified');
CREATE TYPE call_kind        AS ENUM ('closer','triage');
CREATE TYPE day_status       AS ENUM ('draft','chosen','edited','closed');
CREATE TYPE proposal_status  AS ENUM ('pending','accepted','rejected','superseded');
CREATE TYPE adjustment_status AS ENUM ('pending','proposed','done','failed','cancelled');
CREATE TYPE habit_kind       AS ENUM ('boolean','numeric');
CREATE TYPE habit_log_source AS ENUM ('agent','user');
CREATE TYPE habit_period     AS ENUM ('day','week');
CREATE TYPE task_kind        AS ENUM ('whatsapp_confirm','lead_context','follow_up','other');
CREATE TYPE task_origin      AS ENUM ('agent','user');
CREATE TYPE change_action    AS ENUM ('create','update','delete','replace','choose','close','propose','accept','reject','shift');
CREATE TYPE webhook_status   AS ENUM ('collecting','pending','sent','failed');
CREATE TYPE auth_method      AS ENUM ('setup','pin','passkey','recovery_code','reset_code');
CREATE TYPE lockout_scope    AS ENUM ('device','global');

-- ===== planning =====
CREATE TABLE day (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  date date NOT NULL CONSTRAINT day_date_uq UNIQUE,
  status day_status NOT NULL DEFAULT 'draft',
  chosen_option_id uuid REFERENCES plan_option(id) ON DELETE SET NULL,
  notes text, calls_summary text,
  weekly_gym_done smallint, weekly_gym_target smallint,
  review_energy smallint, review_mood smallint, review_text text, reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT day_chosen_requires_option CHECK (status NOT IN ('chosen','edited') OR chosen_option_id IS NOT NULL),
  CONSTRAINT day_closed_has_closed_at  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT day_weekly_gym_pair CHECK ((weekly_gym_done IS NULL) = (weekly_gym_target IS NULL)
        AND (weekly_gym_done IS NULL OR (weekly_gym_done >= 0 AND weekly_gym_target > 0))),
  CONSTRAINT day_review_complete CHECK ((review_energy IS NULL) = (review_mood IS NULL)
        AND (review_text IS NULL OR review_energy IS NOT NULL)),
  CONSTRAINT day_review_energy_range CHECK (review_energy BETWEEN 1 AND 5),
  CONSTRAINT day_review_mood_range   CHECK (review_mood BETWEEN 1 AND 5)
);
CREATE INDEX day_status_idx ON day (status);

CREATE TABLE plan_option (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  day_id uuid NOT NULL REFERENCES day(id) ON DELETE CASCADE,
  label text NOT NULL, title text NOT NULL, description text,
  "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT plan_option_day_label_uq UNIQUE (day_id, label),
  CONSTRAINT plan_option_id_day_uq    UNIQUE (id, day_id),
  CONSTRAINT plan_option_label_format CHECK (label ~ '^[A-Z]$')
);

CREATE TABLE block (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  option_id uuid NOT NULL, day_id uuid NOT NULL REFERENCES day(id) ON DELETE CASCADE,
  start text NOT NULL, "end" text,
  title text NOT NULL, type block_type NOT NULL, call_kind call_kind, detail text,
  lead jsonb,                                   -- { name, phone?, whatsapp?, notes?, crmUrl? }
  source block_source NOT NULL, external_id text, external_url text, calendar calendar_kind,
  status block_status NOT NULL DEFAULT 'pending', status_at timestamptz,
  outcome call_outcome, note text,
  locked boolean NOT NULL DEFAULT false,
  remind boolean NOT NULL DEFAULT false,        -- app defaults it to true for calls
  user_overrides text[] NOT NULL DEFAULT '{}',
  removed_from_calendar_at timestamptz,
  "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT block_option_fk FOREIGN KEY (option_id, day_id) REFERENCES plan_option(id, day_id) ON DELETE CASCADE,
  CONSTRAINT block_start_format CHECK (start ~ '^([01][0-9]|2[0-9]):[0-5][0-9]$'),
  CONSTRAINT block_end_format   CHECK ("end" IS NULL OR "end" ~ '^([01][0-9]|2[0-9]):[0-5][0-9]$'),
  CONSTRAINT block_calendar_requires_external_id CHECK (source <> 'calendar' OR external_id IS NOT NULL),
  CONSTRAINT block_outcome_only_calls   CHECK (outcome IS NULL OR type = 'call'),
  CONSTRAINT block_lead_only_calls      CHECK (lead IS NULL OR type = 'call'),
  CONSTRAINT block_call_kind_only_calls CHECK (call_kind IS NULL OR type = 'call'),
  CONSTRAINT block_removed_only_calendar CHECK (removed_from_calendar_at IS NULL OR source = 'calendar'),
  CONSTRAINT block_user_overrides_values CHECK (user_overrides <@ ARRAY['start','end','title','type','callKind','detail','lead','order']::text[])
);
CREATE UNIQUE INDEX block_option_external_uq ON block (option_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX block_day_external_idx ON block (day_id, external_id);
CREATE INDEX block_option_order_idx ON block (option_id, "order");

CREATE TABLE proposal (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  day_id uuid NOT NULL REFERENCES day(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,                       -- the full DayInput the agent sent
  reason text, status proposal_status NOT NULL DEFAULT 'pending',
  base_day_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX proposal_one_pending_per_day_uq ON proposal (day_id) WHERE status = 'pending';
CREATE INDEX proposal_day_created_idx ON proposal (day_id, created_at);

CREATE TABLE adjustment (                       -- "Pedir ajuste": free-text request to Agenbot
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  date date NOT NULL, text text NOT NULL,
  status adjustment_status NOT NULL DEFAULT 'pending',
  agent_note text,
  proposal_id uuid REFERENCES proposal(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT adjustment_text_length CHECK (char_length(text) BETWEEN 1 AND 1000)
);
CREATE INDEX adjustment_date_created_idx ON adjustment (date, created_at);
CREATE INDEX adjustment_proposal_idx ON adjustment (proposal_id);

-- ===== tracking =====
CREATE TABLE habit (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL CONSTRAINT habit_slug_uq UNIQUE, name text NOT NULL,
  kind habit_kind NOT NULL, unit text,
  target_count integer NOT NULL, target_period habit_period NOT NULL,
  block_type block_type,                        -- marking a block of this type done auto-logs the habit
  active boolean NOT NULL DEFAULT true, "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT habit_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT habit_target_positive CHECK (target_count > 0),
  CONSTRAINT habit_unit_only_numeric CHECK (unit IS NULL OR kind = 'numeric')
);

CREATE TABLE habit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  habit_id uuid NOT NULL REFERENCES habit(id) ON DELETE CASCADE,
  date date NOT NULL, done boolean NOT NULL, value numeric(12,2),
  source habit_log_source NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT habit_log_habit_date_uq UNIQUE (habit_id, date)
);
CREATE INDEX habit_log_date_idx ON habit_log (date);

CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  date date NOT NULL,                           -- every task is day-scoped; no due time, no reminder
  title text NOT NULL, kind task_kind NOT NULL DEFAULT 'other', origin task_origin NOT NULL,
  done boolean NOT NULL DEFAULT false, done_at timestamptz,
  related_block_id uuid REFERENCES block(id) ON DELETE SET NULL,
  "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT task_done_at_consistent CHECK (done = (done_at IS NOT NULL))
);
CREATE INDEX task_date_order_idx ON task (date, "order");

CREATE TABLE sleep_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  date date NOT NULL CONSTRAINT sleep_log_date_uq UNIQUE,   -- the night starting that day
  bed_at timestamptz, bed_source habit_log_source,
  woke_at timestamptz, wake_source habit_log_source,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1, updated_by actor NOT NULL,
  CONSTRAINT sleep_log_bed_source  CHECK ((bed_at IS NULL) = (bed_source IS NULL)),
  CONSTRAINT sleep_log_wake_source CHECK ((woke_at IS NULL) = (wake_source IS NULL)),
  CONSTRAINT sleep_log_order CHECK (bed_at IS NULL OR woke_at IS NULL
        OR (woke_at > bed_at AND woke_at - bed_at < interval '20 hours'))
);

-- ===== sync / audit =====
CREATE TABLE change_log (                       -- append-only audit; never pruned
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  actor actor NOT NULL, entity text NOT NULL, entity_id uuid, date date,
  action change_action NOT NULL, diff jsonb, forced boolean NOT NULL DEFAULT false,
  request_id text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_at_idx ON change_log (at);
CREATE INDEX change_log_date_idx ON change_log (date);
CREATE INDEX change_log_entity_idx ON change_log (entity, entity_id);

CREATE TABLE idempotency_key (
  key text NOT NULL, actor actor NOT NULL,
  method text NOT NULL, path text NOT NULL, request_hash text NOT NULL,
  response_status integer,                      -- NULL = in flight
  response_body text,                           -- stored as text so replays are byte-identical
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_key_pk PRIMARY KEY (actor, key)
);
CREATE INDEX idempotency_key_created_idx ON idempotency_key (created_at);

CREATE TABLE webhook_outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),         -- = batchId = Idempotency-Key sent to Agenbot
  date date NOT NULL, payload jsonb NOT NULL,
  status webhook_status NOT NULL DEFAULT 'collecting',
  attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL, last_attempt_at timestamptz,
  last_response_status smallint, last_error text, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX webhook_outbox_one_collecting_per_day_uq ON webhook_outbox (date) WHERE status = 'collecting';
CREATE INDEX webhook_outbox_due_idx ON webhook_outbox (next_attempt_at) WHERE status IN ('collecting','pending');

CREATE TABLE notification_log (                 -- push dedupe keys: remind:<block>:<start>, sleep:<night>; never pruned
  key text PRIMARY KEY, sent_at timestamptz NOT NULL DEFAULT now()
);

-- ===== auth =====
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  singleton boolean NOT NULL DEFAULT true CONSTRAINT app_user_singleton_uq UNIQUE,
  pin_hash text NOT NULL, pin_updated_at timestamptz NOT NULL DEFAULT now(),
  webauthn_user_id bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_singleton CHECK (singleton)
);

CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL, user_agent text,
  session_hash text NOT NULL CONSTRAINT device_session_hash_uq UNIQUE,   -- sha256(session token)
  last_seen_at timestamptz NOT NULL DEFAULT now(), last_unlock_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_active_idx ON device (last_seen_at) WHERE revoked_at IS NULL;

CREATE TABLE passkey (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE CONSTRAINT passkey_device_uq UNIQUE,
  credential_id text NOT NULL CONSTRAINT passkey_credential_id_uq UNIQUE,
  public_key bytea NOT NULL, counter bigint NOT NULL DEFAULT 0, transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);

CREATE TABLE push_subscription (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  endpoint text NOT NULL CONSTRAINT push_subscription_endpoint_uq UNIQUE,
  p256dh text NOT NULL, auth text NOT NULL,
  call_reminders boolean NOT NULL DEFAULT true, sleep_reminders boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,      -- never incremented (dead column)
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_code  (id uuid PRIMARY KEY DEFAULT uuidv7(), hash text NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE pin_reset_code (id uuid PRIMARY KEY DEFAULT uuidv7(), hash text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE auth_attempt (                      -- every credential check; never pruned
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  method auth_method NOT NULL, success boolean NOT NULL,
  device_key text, device_id uuid REFERENCES device(id) ON DELETE SET NULL,
  ip text, user_agent text, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempt_at_idx ON auth_attempt (at);

CREATE TABLE auth_lockout (
  scope lockout_scope NOT NULL, key text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0, lockout_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz, last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_lockout_pk PRIMARY KEY (scope, key)
);

-- ===== triggers (0001, 0003, 0007) =====
-- bump_row_version(): NEW.updated_at = now(); NEW.version = OLD.version + 1
--   BEFORE UPDATE on day, plan_option, block, habit, habit_log, task, sleep_log, adjustment
-- touch_updated_at(): NEW.updated_at = now()
--   BEFORE UPDATE on webhook_outbox, app_user, device, auth_lockout, push_subscription
```

ER notes (from `docs/er.md` / `docs/decisions.md`): `block.day_id` is denormalized and kept consistent by the
composite FK. Calendar events are **duplicated per option** (A and B each get a copy). `Day.version` is bumped by any
write to the day, its options or its blocks (domain code calls `touchDay`).

---

## 4. Features

| Feature | Where | Status | Notes / UX |
|---|---|---|---|
| First-run setup | `ui/screens/auth.tsx` `SetupScreen`; `POST /api/auth/setup` | **Complete** | SETUP_CODE + 6-digit PIN ×2 → shows 10 recovery codes (copy/download). After that, 404 forever. |
| Unlock (PIN / fingerprint) | `UnlockScreen`, `components/pin-pad.tsx` | **Complete** | 6-dot pad, fingerprint first when enabled, remaining-attempts and lockout messages, recovery flow ("Usar código de recuperación" / "Código del servidor"). |
| **Hoy** timeline | `ui/screens/today/*` | **Complete** | Header swipe changes day; option carousel (A/B) with page dots before choosing; "now" line plus auto-scroll; **swipe** right = done / left = skipped (96 px threshold, haptic, undo toast); **long-press drag** to move (dnd-kit Touch+Mouse sensors, 15-min snap); calls show a WhatsApp button and an outcome picker; blocks removed from Google are shown struck through. |
| Block editor | `today/block-editor.tsx` | **Complete** | Create/edit own blocks; calendar blocks only allow tracking fields; call kind closer/triage; lead; "Avisarme 10 min antes"; lock. Uses raw `<textarea>`/`<input>` styled with a shared class string. |
| Proposals (Agenbot re-plan) | `components/extensions.tsx` `ProposalDiffView` | **Complete** | Banner → diff sheet (moved/added/removed/changed/kept/preserved overrides) → Aceptar/Rechazar. |
| "Me atrasé" (shift) | `ShiftChooser` | **Complete** | +15/+30/+60, affected count, `(+1)` past midnight. |
| "Armar mi día" | `EmptyState` → `POST /api/days/{date}` | **Complete** | Own day, already chosen; a later agent load becomes a proposal. |
| "Pedir ajuste" (requests to Agenbot) | `today/adjustments.tsx` | **Complete** | + button → "Nuevo evento" / "Pedido a Agenbot"; free text + date (**native `<input type="date">`**); card with status + agent note; foldable list (last 2 commits); badge on Hoy tab. |
| Sleep tracking | `SleepCard`, `today/sleep-editor.tsx` | **Complete** | "Me voy a dormir" / "Me levanté" buttons by time of day; morning card until filled; manual edit. |
| Day review ("Cierre del día") | `DayReviewCard` | **Complete** | After 22:00: energy/mood 1–5 + note. |
| Tareas y hábitos | `ui/screens/tasks.tsx` | **Complete** but thin | Tasks for **today only**, grouped by kind (WhatsApp/lead context/follow-up/other); add a task (title only); habits with Ring + StreakChip. No dates, times, reminders, or undated inbox. |
| Habits settings | `habits-settings.tsx` | **Complete** | Create/edit boolean/numeric, target per day/week, link to block type, active toggle. No delete (only deactivate). |
| Historial | `history.tsx` | **Complete** | Month heat-map, monthly average, call count, day sheet with review. |
| Métricas | `metrics.tsx` | **Complete** | Week/Month/Year; completion, gym, closer close rate, triage qualify rate, show-up, outcome bars, done by type, reading days, sleep, streaks. Hand-made SVG bar chart / sparkline. Very sales-closer specific. |
| Opciones del día | `options-history.tsx` | **Complete** | Chosen vs not chosen per day. |
| Ajustes | `settings.tsx` | **Complete** | Theme (system/dark/light), push on/off + 2 per-device toggles, Agenbot webhook status, export JSON, install card, version / check for update. |
| Seguridad | `security.tsx` | **Complete** | Fingerprint toggle, change PIN, regenerate codes, device list (rename/revoke). |
| Offline mode | `client/sync.ts`, `client/queries.ts` | **Complete** | IndexedDB-first render, optimistic writes, outbox replay with Idempotency-Key, conflict sheet ("Mantener el mío" / "Usar servidor"). Only block/task/adjustment writes are optimistic; settings/auth are online-only. |
| Design gallery | `/dev/design` | Dev tool | Not in production. |
| Leads module, block attachments/tags/timer | — | **Not built** | Marked as future in the design. |

**TODO / FIXME / HACK / XXX:** **none** in `src/`, `scripts/`, `tests/` or `public/sw.js`. (The only "XXXX" matches
are the recovery-code format string at `src/server/auth/crypto.ts:40` and `src/ui/screens/auth.tsx:289`.) Lint
suppressions: `src/server/http/context.ts:38` (`any` in `Handler`), `src/ui/screens/auth.tsx:201`
(exhaustive-deps), `tests/helpers/api.ts:11,21-26` (`any`).

---

## 5. Auth & security

### 5.1 PIN, end to end
1. **Setup:** `POST /api/auth/setup` `{ setupCode, pin, deviceName? }`. The setup code is compared length-checked
   with `Buffer.equals`; it is not formally constant-time, but it's single-use and goes through lockout. The PIN is
   hashed with **Argon2id** (19 MiB, t=2, p=1; `src/server/auth/crypto.ts`) into `app_user.pin_hash`. The singleton
   row is enforced by a UNIQUE + CHECK. 10 recovery codes (`XXXX-XXXX-XXXX`, 32-char alphabet) are each stored as
   an Argon2id hash. A `device` row is created.
2. **Session:** a random 32-byte base64url token goes in cookie **`agenda_session`**
   (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age = DEVICE_TRUST_DAYS × 86400`, i.e. 90 days). Only
   **sha256(token)** is stored (`device.session_hash`). Each unlock re-issues the token (rotation).
3. **Resolve** (`src/server/auth/session.ts`): look up the token hash on a non-revoked device. If idle for more than
   `DEVICE_TRUST_DAYS` → no session. If idle for more than **`PIN_REAUTH_DAYS` (7)** → session exists but `locked`
   (401 `device_locked`). Every authenticated request calls `touchDevice` (throttled to one write per minute), so
   **the 7-day re-ask is inactivity-based, not every 7 days**. If you use the app daily, it never asks again until
   90 days of inactivity. This differs from the "re-asked after 7 days" assumption.
4. **Unlock:** `POST /api/auth/unlock { pin }` → Argon2 verify → re-issue session.
5. **Change PIN / regenerate codes** require the current PIN. **Recover:** a recovery code (consumed) or a reset code
   from `pnpm auth:reset-pin` (8 digits, Argon2-hashed in `pin_reset_code`, 15-min TTL, single use) sets a new PIN.
   As stated, there's **no email recovery**.

### 5.2 Brute-force protection (`src/server/auth/lockout.ts`)
- Counters per **device** (session device id, or a pre-auth random cookie `agenda_dk` that lives 400 days) and
  **global**. **5 failures/device or 20 global → lock** for 15 min × 2^(n−1), capped at 24 h. Success resets both.
- Every attempt (setup/pin/passkey/recovery/reset) is logged to `auth_attempt` (IP from `X-Forwarded-For`, which is
  spoofable and only used for logging). Failures are written on the pool, outside the request transaction, so they
  survive the rollback.
- **Concern (DoS):** anyone on the internet can trigger the **global** lock (20 wrong PINs from fresh browsers) and
  keep re-locking it for up to 24 h. Already-unlocked sessions keep working, because the lock only affects
  credential checks. But a locked device, or a new phone, can't get in.

### 5.3 Biometric / WebAuthn (`src/server/auth/auth.ts`)
- `@simplewebauthn/server` v14. Registration needs an unlocked user session: `authenticatorAttachment: "platform"`,
  `userVerification: "required"`, `residentKey: "preferred"`, attestation `none`. **One passkey per device**
  (`passkey.device_id` UNIQUE).
- Challenges are kept in an HMAC-signed cookie `agenda_wa` (SESSION_SECRET, 5 min), not the DB.
- Authentication **requires the existing (locked) session cookie**: the passkey only unlocks a known device and can't
  log in a new browser. `allowCredentials` holds that device's credential; the counter is updated; failures count
  toward lockout.
- RP ID = `WEBAUTHN_RP_ID`, expected origin = `APP_ORIGIN`.

### 5.4 API protection (router, `src/server/http/router.ts`)
- **Agenbot:** `Authorization: Bearer <token>`; the router compares **sha256(token)** constant-time with
  `AGENT_TOKEN_HASH` (env). One static token, no scopes and no expiry. Rotate with `pnpm agent:token` + redeploy. An
  invalid bearer → 401, even if a valid cookie is also present.
- **User:** session cookie (not locked). Per-route `access` enforces agent-only / user-only (403).
- **Internal cron:** `X-Internal-Token` compared constant-time with `INTERNAL_TOKEN`.
- **Rate limit:** in-memory sliding window, **agent only**, 120 req/min (429 + Retry-After). No user rate limit
  beyond the PIN lockout.
- **Idempotency:** optional `Idempotency-Key` on POST/PUT/PATCH for agent/user, stored per actor for 48 h, purged by
  the close-day job. The client never sends it on auth calls, so recovery codes are never persisted in
  `idempotency_key`.
- **Validation:** strict Zod objects (unknown fields → 400). Errors use RFC 9457 problem+json with a machine `code`.
  Every API response carries `Cache-Control: no-store`.
- **CSRF:** no token and no Origin/Referer check. Protection relies on `SameSite=Lax` plus JSON bodies. The router
  does **not** enforce `Content-Type: application/json` (it parses `req.text()`). Sibling subdomains of `lemydev.com`
  count as same-site, so an XSS on another `*.lemydev.com` app could make authenticated writes. **Low–medium risk;
  add an Origin check in the rewrite.**
- **Security headers:** none configured (no CSP, HSTS, X-Frame-Options, Referrer-Policy in `next.config.ts`).
  Cloudflare/Traefik may add some; unknown from the repo.
- **Public surface:** `/api/health` (exposes `APP_VERSION`), `/api/openapi.json` (the full API description).
- **Other concerns:**
  - `tests/helpers/global-setup.ts` runs `DROP SCHEMA public CASCADE` on `TEST_DATABASE_URL` (default
    localhost:5434). If that variable ever pointed at a real DB, it would wipe it.
  - `push.ts` sets `last_success_at` even when sending fails with a non-404/410 error, or when VAPID isn't
    configured. `failure_count` is never incremented.
  - `auth_attempt`, `change_log` and `notification_log` grow forever (no pruning).

---

## 6. Integrations & API contracts

### 6.1 Agenbot (Grok) → Agenda (inbound)
All agent endpoints are `agent` or `agent+user` (see §2.2). Auth: `Authorization: Bearer <agent token>`. JSON only.
Timezone ART. Send `Idempotency-Key` on writes. Use `If-Match`/`version` for concurrency.

**Daily 07:00 sequence** (`README.md`, `scripts/agent-simulation.sh`, fixtures in `scripts/fixtures/`):
1. `GET /api/agent/context?date=YYYY-MM-DD` → weekly gym vs target, habits pending today, streaks at risk, yesterday
   (completion, unfinished tasks), last review, last night's sleep, `skippedPatterns` (≥3 skips and ≥50 % over 14
   days by type+hour), pending proposal.
2. Agenbot reads Google Calendar itself.
3. `PUT /api/days/{date}` with `Idempotency-Key: agenbot-{date}-0700`:

```json
{
  "callsSummary": "2 llamadas: Martín (cierre) 10:00 y Laura (primera llamada) 14:00.",
  "weeklyGym": { "done": 0, "target": 3 },
  "notes": "Turno en el local 16–20.",
  "reason": "optional, shown when it becomes a proposal",
  "options": [
    { "label": "A", "title": "Gym al mediodía", "description": "…",
      "blocks": [
        { "source": "calendar", "externalId": "4f2k…", "externalUrl": "https://www.google.com/calendar/event?eid=…",
          "calendar": "work", "start": "10:00", "end": "10:45", "type": "call", "callKind": "closer",
          "title": "Llamada de cierre", "detail": "…",
          "lead": { "name": "Martín Gómez", "phone": "+54911…", "whatsapp": "54911…", "notes": "…", "crmUrl": "https://…" } },
        { "source": "agent", "start": "12:00", "end": "13:00", "type": "gym", "title": "Gym" }
      ] },
    { "label": "B", "title": "…", "blocks": [ "…" ] }
  ],
  "tasks": [ { "title": "Confirmar a Laura por WhatsApp", "kind": "whatsapp_confirm", "relatedExternalId": "7h3n…" } ],
  "adjustmentIds": ["019a…"]
}
```
   Response `{ "result": "created|replaced|proposed", "day": Day, "proposal": Proposal|null }` with
   **201** (new draft), **200** (draft replaced), **202** (day already chosen → proposal + push), or **409**
   `day_closed`. `?mode=force` applies immediately.
4. During the day: `PATCH /api/days/{date}/blocks/by-external/{eventId}` (Google edit mirrored to every option copy,
   no version check), `PATCH …/blocks/{id}` `{status:"done"}`, `POST …/choose {option}`, `POST /api/sleep/events
   {type:"bed"|"wake", at?}`, `POST …/shift {fromTime, minutes}`, habit logs, tasks.
5. "Pedir ajuste": the agent receives `adjustment.requested` → `PUT` with `adjustmentIds` → `PATCH
   /api/adjustments/{id} {status:"done"|"failed", agentNote}`.

**Ownership rules** (`src/server/domain/ownership.ts`, `merge.ts`) are the core complexity. Calendar schedule fields
are Google's. Schedule fields I edit become `userOverrides` (agent → 409 `user_edit_conflict` unless `force`).
`locked` blocks are untouchable. Tracking fields (status/outcome/note) are mine once set. `locked`/`remind` are mine
only. Blocks are matched on merge by `externalId` → `id` → type+title. Error codes include `calendar_owned`,
`user_edit_conflict`, `day_closed`, `version_conflict`, `invalid_transition`, `adjustment_resolved`,
`shift_out_of_range`, `idempotency_key_reuse`, `idempotency_in_progress`, `rate_limited`, `locked_out`,
`device_locked`.

### 6.2 Agenda → Agenbot (outbound webhook)
- `POST ${AGENT_WEBHOOK_URL}` with `Authorization: Bearer ${AGENT_WEBHOOK_TOKEN}`, `Idempotency-Key: <batchId>`,
  10 s timeout. An empty URL disables it.
- **Only user-originated changes** are sent (no loops). Debounced per date: one `collecting` outbox row per date,
  `next_attempt_at = now + WEBHOOK_DEBOUNCE_SECONDS` (120). `choose`, proposal accept/reject and adjustment events
  are sent immediately (`kickWebhooks()` after commit).
- Retries: up to **5 attempts**, backoff 30 s · 2 min · 8 min · 32 min, then `failed` (visible in Ajustes).
  Delivered by the in-process worker (`src/server/jobs.ts`).
- Payload `day.updated_by_user`:
```json
{ "event": "day.updated_by_user", "batchId": "019a…", "date": "2026-10-19", "dayVersion": 4,
  "changes": [ { "entity": "block", "id": "…", "action": "update",
                 "fields": { "status": { "from": "pending", "to": "done" } },
                 "block": { "title": "…", "type": "call", "start": "10:00", "externalId": "…", "outcome": "follow_up" },
                 "at": "2026-10-19T10:48:03.551-03:00" } ],
  "summary": { "blocksDone": 5, "blocksTotal": 12, "weeklyGym": { "done": 2, "target": 3 } },
  "dayUrl": "https://agenda.lemydev.com/api/days/2026-10-19" }
```
- Standalone events: `adjustment.requested` / `adjustment.cancelled`
  `{ event, adjustmentId, date, text, createdAt, adjustmentUrl, dayUrl[, cancelledAt] }`.

### 6.3 Google Calendar
**No direct integration.** There's no `googleapis` dependency or OAuth. Calendar data arrives only through Agenbot as
`source: "calendar"` blocks with `externalId`/`externalUrl`/`calendar: work|personal`. The only `googleapis` string
in `src/` is an example FCM push endpoint.

### 6.4 Cloudflare / storage / other
- **No image or object storage in code.** No uploads, R2/S3 SDK, or presigned URLs. Cloudflare appears only in the
  README as DNS (proxied, Full strict TLS) and as an **R2 bucket for Coolify's Postgres backups**, configured in
  Coolify, not in this repo.
- **Web Push:** §7. **Fonts:** Google Fonts via `next/font` (self-hosted at build). No analytics, no Sentry, no email.

---

## 7. PWA

- **Manifest** (`src/app/manifest.ts`): name/short_name "Agenda", `id/start_url/scope "/"`, `display: standalone`,
  portrait, bg/theme `#111312`, `lang es-AR`, icons 192/512 any + maskable + monochrome + SVG, shortcuts (Tareas,
  Métricas). Apple: `appleWebApp.capable`, `black-translucent`, apple-touch-icon. Icons are generated by
  `scripts/pwa-icons.mjs` (headless Chromium; sharp builds are disabled).
- **Service worker:** **hand-written** `public/sw.js` (Serwist was rejected because its plugin targets webpack and the
  project uses Turbopack). Cache version `agenda-v2`, bumped by hand.
  - Navigations: network-first, cached per pathname, fallback to the cached shell (`/`, `/tareas`, `/historial`,
    `/metricas`, `/ajustes` precached).
  - `/_next/static/*`: cache-first. Other same-origin GETs: stale-while-revalidate.
  - `/api/*`: **never cached** by the SW.
  - Registered only in production (`src/ui/pwa.ts`), `skipWaiting` + `clients.claim`.
- **Offline data:** Dexie DB `agenda` (`cache`, `outbox`). The cache is versioned (`CACHE_VERSION = 2`), pruned
  after 14 days, and rendered before the network. An offline cold start trusts the last known session state from
  `localStorage`.
- **Install prompt:** captures `beforeinstallprompt` (Android/Chromium) → "Instalar" card in Ajustes. No custom iOS
  "Add to Home Screen" instructions.
- **Web Push:**
  - VAPID env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The public key is served at runtime through
    `GET /api/auth/session` (`vapidPublicKey`), so no rebuild is needed.
  - Subscriptions live in `push_subscription` (per device, endpoint UNIQUE, toggles `call_reminders` /
    `sleep_reminders`; per-device prefs are mirrored in `localStorage`).
  - Sending (`src/server/push.ts`) fans out to all subscriptions, sequentially, TTL 3600. On 404/410 the
    subscription is deleted.
  - Triggers: "Agenbot cargó tu día" (day load), proposal ready / "Tu ajuste está listo", adjustment applied/failed,
    **10-min block reminder** (`remind` on, pending, chosen option; dedupe in `notification_log`), and the
    **morning sleep reminder** at `SLEEP_REMINDER_TIME`.
  - SW `push` → `showNotification` with tag/badge/vibrate; `notificationclick` focuses and navigates the existing
    window (deep links like `/?date=…&proposal=1`).
- **Caveats:**
  - Reminders come from a 30 s in-process loop. A reminder whose 10-min window is missed during downtime is
    **skipped** (no catch-up).
  - No push payload encryption concerns beyond web-push defaults.
  - iOS (16.4+ installed PWA push) isn't specifically handled or tested. E2E targets Android Chrome only.

---

## 8. Config & deployment

### 8.1 Environment variables (from `src/server/env.ts`, `.env.example`, code)

| Name | Required | Purpose / where |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres URL (`db/client.ts`, `migrate.ts`, `drizzle.config.ts`). Internal Coolify hostname in prod. |
| `TEST_DATABASE_URL` | tests only | Test DB; **schema is dropped** by the test setup. |
| `E2E_DATABASE_URL` | e2e only | Playwright DB (`agenda_e2e`). |
| `APP_ORIGIN` | yes in prod (default `http://localhost:3000`) | WebAuthn expected origin; webhook `dayUrl`/`adjustmentUrl`. |
| `TZ` | recommended | `America/Buenos_Aires` (Dockerfile sets it). The code hard-codes −03:00 anyway. |
| `SESSION_SECRET` | **yes** (≥16 chars) | HMAC for the WebAuthn challenge cookie. |
| `SETUP_CODE` | **yes** | One-time first-run code. |
| `AGENT_TOKEN_HASH` | **yes** (64-hex sha256) | Agenbot bearer verification. |
| `INTERNAL_TOKEN` | **yes** (≥16) | `X-Internal-Token` for `/api/internal/close-day`. |
| `WEBAUTHN_RP_ID` | yes in prod (default `localhost`) | Passkey RP ID (`agenda.lemydev.com`). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional | Web Push; push is a no-op without them. |
| `AGENT_WEBHOOK_URL` | optional (empty disables) | Outbound webhook to Agenbot. |
| `AGENT_WEBHOOK_TOKEN` | optional | Bearer sent to Agenbot. |
| `WEBHOOK_DEBOUNCE_SECONDS` | optional (120) | Webhook batching. |
| `PIN_REAUTH_DAYS` | optional (7) | Idle days before the PIN is asked again. |
| `DEVICE_TRUST_DAYS` | optional (90) | Idle days before the session dies; cookie max-age. |
| `SLEEP_REMINDER_TIME` | optional (`10:00`) | Morning sleep push. |
| `APP_VERSION` | optional (`dev`) | Build arg → `/api/health`, Ajustes. |
| `SKIP_MIGRATIONS` | optional | `1` = entrypoint skips migrations. |
| `MIGRATIONS_DIR` | optional | Migrator folder (`./drizzle`). |
| `DISABLE_WORKER` | optional | `1` = no in-process worker (tests/e2e). |
| `ARGON2_MEMORY_KIB` | optional | Lowers Argon2 memory in tests. |
| `NEXT_RUNTIME`, `NODE_ENV`, `PORT`, `HOSTNAME` | runtime | Standard. |

### 8.2 Build & run
- **Dockerfile:** 3 stages on `node:24-alpine` (deps → build → runtime). It runs `pnpm build` (Next standalone) and
  `scripts/build-cli.mjs` (esbuild bundles migrate/reset-pin/recovery-codes/agent-token into `dist-cli` → `/app/cli`).
  It copies the `@node-rs` native Argon2 addon. The runtime prepares pnpm via corepack (offline), runs as non-root
  `agenda`, `EXPOSE 3000`, `TZ=America/Buenos_Aires`.
- **Start:** `docker/entrypoint.sh` → `node cli/migrate.mjs` (unless `SKIP_MIGRATIONS=1`) → sets `HOSTNAME=::` when
  IPv6 is present (Coolify's localhost healthcheck) → `exec node server.js`.
- **Healthcheck:** Docker `HEALTHCHECK` every 30 s: `wget http://127.0.0.1:3000/api/health` (returns 503 if the DB
  is down). README tells you to set the same in Coolify.
- **Port:** 3000. **Domain:** `agenda.lemydev.com` (README; Coolify domain config, Cloudflare proxied, Full strict).
  Nothing domain-specific is in code except the env vars.
- **Cron:** a Coolify Scheduled Task does a `wget POST` with `X-Internal-Token` to `/api/internal/close-day` at
  00:05 ART (`5 3 * * *` on a UTC server). Lazy close covers missed runs.
- **Single replica required:** the in-process worker (webhooks, reminders) and the in-memory rate limit assume one
  container.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, `db:check`, `openapi:check` (drift), `openapi:lint`,
  `icons:check`, vitest with coverage on a PG18 service, Playwright e2e, and an arm64 Docker build with QEMU. No
  deploy step; Coolify builds from git.

---

## 9. Code quality

| Check | Result |
|---|---|
| `next typegen && tsc --noEmit` | **0 errors** (exit 0) |
| `eslint` | **0 errors, 0 warnings** (exit 0) |
| Tests (vitest unit + API, Playwright e2e) | **Not run**: they all need Postgres (global setup migrates and drops the schema). The last recorded run is in `docs/test-report.md` (2026-10-19): **101/101 passed**, coverage 90.4 % statements / 79.9 % branches / 90.9 % functions / 93.4 % lines of `src/server` + `src/contract`. Later commits added `tests/api/calls.test.ts`, so the current count is unknown. |
| Contract tests | Every API test response is validated against `openapi.yaml` with Ajv. A test asserts that every operationId is implemented. |

**Strengths:** consistent layering (contract → router → handler → domain → db), pure and unit-tested domain rules
(`ownership.ts`, `merge.ts`, `streaks.ts`), DB-enforced invariants (CHECKs, partial unique indexes, version
triggers), one transaction per request with after-commit side effects, thorough decision log.

**Issues / inconsistencies:**
- **React Compiler not enabled**, which conflicts with the stated global standard. Manual `useCallback`/`useMemo` in
  `src/ui/components/overlay.tsx`, `src/ui/screens/auth.tsx`, `src/ui/screens/today/timeline.tsx`.
- **No form primitives in the design system.** Raw `<input>`/`<textarea>` with a copy-pasted `field` class string in
  `security.tsx`, `habits-settings.tsx`, `block-editor.tsx`, `adjustments.tsx`, `today.tsx`. There's one native
  `<input type="date">` (`today/adjustments.tsx:106`). No Select/DatePicker/TimePicker components.
- **Duplicated helpers:** `addDays`/`monthStart`/`monthEnd` exist in both `src/server/time.ts` and
  `src/ui/time.ts`/`src/ui/screens/history.tsx`, with different noon-vs-midnight anchoring. The month navigator
  markup (prev/next buttons) is repeated in `history.tsx`, `metrics.tsx`, `options-history.tsx`.
- **Hard-coded TZ offset** (−03:00) across server and client. A `TZ` env var exists but the math ignores it.
- **Dead/misleading code:** `push_subscription.failure_count` is never incremented; `last_success_at` is set on
  failed sends. `tsconfig.tsbuildinfo` (363 KB) sits in the root (git-ignored).
- **Unbounded tables:** `change_log`, `auth_attempt`, `notification_log` are never pruned.
- **Very large generated artifacts committed:** `openapi.yaml` (775 KB) and `docs/api-examples.md` (14.8 k lines).
  The e2e run writes PNGs into tracked `docs/screenshots/`.
- `Handler` input is typed `any` (`src/server/http/context.ts:38`). Params/body types aren't inferred from the route
  Zod schemas, so handlers rely on runtime validation only.
- **Domain over-fit:** call outcomes, closer/triage, `lead` JSON, `weekly_gym_*` columns, `calls_summary`, and
  block types like `dogs`/`partner`/`local_work`/`padel` are baked into enums and columns.

---

## 10. Design & UI ("Sistema Calma" v0.2)

- **Source:** `design/Agenda - Sistema.dc.html` (Claude Design export), implemented in `src/app/globals.css`, with a
  live gallery at `/dev/design`. Doc: `docs/design.md`.
- **Theme:** **dark is primary.** It follows `prefers-color-scheme`; `data-theme="dark|light"` on `<html>` forces
  one per device (localStorage `agenda:theme`, inline boot script to avoid a flash). Every color is a semantic CSS
  variable mapped to Tailwind with `@theme inline`.
- **Palette** (dark / light):
  - bg `#111312`/`#F7F6F2`, sunken `#0B0C0B`/`#ECEBE6`, surface `#191B1A`/`#FFFFFF`, surface2 `#1F2220`/`#F0EFEA`,
    raised `#262A27`/`#FFFFFF`, border `#262927`/`#E4E3DD`, border2 `#3A3E3B`/`#C9C8C1`
  - text `#ECEDEA`/`#1A1B18`, text2 `#B8BCB6`/`#3F413C`, muted `#9A9E98`/`#62655F`
  - accent (mint-teal) `oklch(.82 .08 160)` / `oklch(.48 .08 160)`, call (amber) `oklch(.84 .12 70)` /
    `oklch(.52 .12 62)`, success, warning, danger, plus `-soft` alpha variants, `on-*`, inverse, scrim, shadow
  - **Block type colors:** fixed L/C per theme with a per-type hue (`oklch(.78 .06 h)` dark,
    `oklch(.50 .08 h)` light), registry in `src/ui/block-types.ts`.
- **Fonts:** **Instrument Sans** (400–700, UI) + **Geist Mono** (400/500, times/numbers) via `next/font/google`.
- **Type scale:** display 32/600, title 22/600, headline 18/600, body 16/500, body-sm 14, caption 13, mono 12,
  micro 11/500.
- **Radius** 8/12/16/20/28 + pill. **Motion** 80/120/200/280 ms, `cubic-bezier(.2,.8,.2,1)`, reduced-motion
  respected. Elevation by tone in dark, white + `shadow-calma` in light.
- **Icons:** Material Symbols Rounded as an SVG sprite (`pnpm icons` from the `src/ui/icons.ts` list). Offline-safe,
  with no 3 MB font.
- **Components** (`src/ui/components/*`): `Button`, `FilterChip`, `StatusChip`, `Segmented`, `Toggle`, `Ring`,
  `StreakChip`, `Fab`, `PageDots`, `BottomSheet` (swipe-to-close, page scroll lock), `ToastHost`/`useToast` (with
  undo action), `Banner`, `SyncStatus`, `Sheet`/`RowGroup`/`SheetRow`/`SettingsRow`, `SectionCard`, `OptionCard`,
  `EmptyState`, `TimelineSkeleton`, `StatCard`, `ChartCard`, `BarChart`, `Sparkline`, `HeatCell`, `PinPad`,
  `TabBar`/`Sidebar`/`DayHeader`, `PageTitle`/`SectionLabel`, `BlockCard` + `NowLine`, `BrandMark`, `Icon`.
  Domain extensions: `SleepCard`, `ProposalDiffView`, `ShiftChooser`, `ConflictCompare`, `DayReviewCard`,
  `OutcomePicker`.
- **Layouts:**
  - **Mobile:** single column, `max-w-[560px]`, safe-area padding, fixed bottom **TabBar** (Hoy · Tareas ·
    Historial · Métricas · Ajustes) with a badge on Hoy. Sheets slide from the bottom.
  - **Desktop (md+):** sticky left **Sidebar** + column `max-w-[720px]`.
  - The auth screens are full-bleed and centered, with the app icon.
- UI copy is in Rioplatense Spanish; code is in English.

---

## 11. Recommendations for the rewrite

New direction: a hub for **tasks, reminders (date/time + Web Push) and events** created by an AI assistant (Open WebUI
+ Claude) through an **OpenAPI-documented API**. Google Calendar becomes **read-only**, and Grok/Agenbot is removed.

### 11.1 Keep / reuse (port, don't copy the whole thing)
| What | Where | Why |
|---|---|---|
| **Contract-first API pipeline**: Zod schemas + route catalogue with paired examples → OpenAPI 3.1 generator, served at `/api/openapi.json` (compact vs `?examples=true`), CI drift check, Redocly lint | `src/contract/*`, `scripts/openapi.ts`, `redocly.yaml` | This is exactly what Open WebUI tool servers consume. Note the zod-to-openapi workarounds (`orNull`, spreading `.shape`; D33). |
| **Single dispatcher router**: route matching from the catalogue, per-route `access`, strict validation with JSON-pointer errors, problem+json, one transaction per request, `afterCommit` | `src/server/http/router.ts`, `context.ts`, `errors.ts`, `src/contract/problems.ts` | Small, tested, framework-agnostic. Improve it by inferring handler types from the Zod schemas (drop the `any`). |
| **Idempotency keys** (reserve outside the tx, replay byte-identical, 422 on reuse, 409 in flight, 48 h TTL) | `src/server/http/idempotency.ts` | Essential for an LLM client that retries. |
| **Optimistic concurrency** via DB triggers + `If-Match`/`version` | `drizzle/0001_row_version_triggers.sql`, `domain/days.ts checkVersion` | Prevents AI-vs-human overwrites. |
| **Contract tests** (every response validated against the spec, every operation implemented) | `tests/helpers/contract.ts`, `tests/api/platform.test.ts` | Keeps the AI-facing docs honest. |
| **Auth module**: Argon2id PIN, hashed session tokens on device rows, idle-based re-auth, device list/revoke, recovery codes, CLI reset code, lockout with device+global counters | `src/server/auth/*`, `auth` tables in `schema/auth.ts`, `ui/screens/auth.tsx`, `security.tsx`, `components/pin-pad.tsx` | Mature and well tested. Revisit global-lock DoS (§5.2) and add an Origin check. |
| **WebAuthn "unlock this device"** flow | `src/server/auth/auth.ts` (passkey*), signed challenge cookie | Clean pattern for the fingerprint unlock. |
| **Bearer token for the machine client** (sha256 in env, constant-time) | `router.ts`, `scripts/agent-token.ts` | Reuse for the Open WebUI client. Consider DB-stored tokens with names/scopes if more clients appear. |
| **Web Push stack**: VAPID key served at runtime, subscription per device with toggles, sender with 404/410 cleanup, SW push/notificationclick deep links, `notification_log` dedupe | `src/server/push.ts`, `public/sw.js`, `src/ui/pwa.ts`, `jobs.ts once()` | The core of reminders. Fix `failure_count`/`last_success_at`. |
| **Transactional outbox + worker** pattern (claim with optimistic update, backoff, failed state) | `src/server/jobs.ts`, `worker.ts`, `webhook_outbox` | Retarget it from the Agenbot webhook to **scheduled reminder delivery**. |
| **Offline-first client**: IndexedDB-hydrated TanStack cache, versioned cache, outbox with Idempotency-Key, optimistic patches, conflict sheet | `src/client/*`, `shell.tsx` `Conflicts` | Battle-tested on the phone. |
| **Hand-written service worker** | `public/sw.js` | Simple and correct for Turbopack. |
| **Design system** (tokens, type scale, motion, icon sprite pipeline, components) | `src/app/globals.css`, `src/ui/components/*`, `scripts/icons.ts`, `design/` | Consistent dark/light. Generalize the block-type registry into a "category/color" registry. |
| **Gesture UX**: swipe done/skip with undo toast, long-press drag (TouchSensor, not PointerSensor; D91), swipe-to-close sheets with scroll lock | `ui/screens/today/timeline.tsx`, `components/overlay.tsx`, `block-card.tsx` | Hard-won mobile details. |
| **Deploy setup**: arm64 multi-stage Dockerfile, migrate-on-start entrypoint, dual-stack `HOSTNAME=::` fix, bundled CLIs, healthcheck, CI arm64 build | `Dockerfile`, `docker/*`, `scripts/build-cli.mjs`, `.github/workflows/ci.yml` | Works on Coolify/Oracle ARM. |
| Habits + streaks logic (if habits survive) | `src/server/domain/streaks.ts`, `tracking.ts` | Pure functions, tested. |
| Sleep log model (if kept) | `sleep_log`, `domain/tracking.ts` | Per-half ownership is neat. |

### 11.2 Discard
- **Day → options (A/B) → blocks + proposals + merge + ownership/userOverrides/locked + "Me atrasé"**
  (`domain/days.ts`, `merge.ts`, `ownership.ts`, `blocks.ts`, `load.ts`, `proposal`, `plan_option`). This exists to
  arbitrate between Agenbot's plans, Google and the user. Without Grok building multi-option plans, it's the bulk of
  the complexity for no benefit.
- **Adjustments ("Pedir ajuste")** and the **outbound Agenbot webhook** (`adjustment`, `webhook_outbox` as a webhook,
  `AGENT_WEBHOOK_*`, `/api/agent/context`, `skippedPatterns`, `listChangelog` as an agent feed).
- **Sales-closer domain:** `call_outcome`, `call_kind`, `lead` jsonb, `calls_summary`, `weekly_gym_*` columns,
  closer/triage metrics, `task_kind` (`whatsapp_confirm`, `lead_context`), the hard-coded `block_type` enum (`dogs`,
  `partner`, `local_work`, `padel`). If needed, replace them with user-defined categories/tags.
- **Times as `text 'HH:mm'` up to `29:59` plus the hard-coded −03:00 offset.** For reminders, store `timestamptz`
  (plus an IANA tz) and use a real tz-aware library (e.g. `Temporal` polyfill or `date-fns-tz`).
- **Calendar events copied per option** and the `by-external` mirror endpoint.
- **Close-day cron + lazy close** (only meaningful for the day-plan model).
- Committed generated bloat (`docs/api-examples.md`, 775 KB `openapi.yaml` with examples): generate in CI instead,
  or commit only the compact spec.

### 11.3 Gaps for the new direction
1. **Task model:** today's `task` is day-scoped with no due time, priority, notes, project/list, recurrence or
   undated "inbox". You need `due_at timestamptz` (nullable), `all_day`, optional recurrence (RRULE), status,
   `source` (`assistant` | `user`), and an optional external reference.
2. **Reminder entity:** nothing generic exists. Reminders are hard-wired (10 min before a block, morning sleep). You
   need a `reminder` table (`fire_at timestamptz`, target task/event, channel, status, `sent_at`, snooze), a
   **durable scheduler** (worker that claims due rows, retries, survives restarts, **catches up missed ones**), and
   snooze/done actions from the notification (SW `notificationclick` with `actions`).
3. **Event entity** independent of "days/options": `starts_at/ends_at timestamptz`, all-day, location, tz, created
   by the assistant, plus read-only Google events.
4. **Google Calendar read-only integration:** none exists. You need OAuth 2.0 (offline refresh token stored
   encrypted), incremental sync (`syncToken`) or a periodic poll, a `calendar_event` cache table with `etag`, and
   handling for deletions and recurring instances. If push channels are used, Google requires a public HTTPS webhook
   endpoint with channel renewal.
5. **AI-facing API design:** OpenAPI with clear `operationId`s and descriptions written for an LLM tool caller,
   small payloads, search/list endpoints with filters (date range, status, text), and natural "upsert by
   client-supplied id". **Open WebUI tool servers** expect a reachable OpenAPI URL plus bearer auth, and possibly
   CORS for the Open WebUI origin, which doesn't exist today.
6. **Machine-client auth:** consider named, revocable API tokens in the DB (the current one is a single env hash),
   per-token rate limits, and an audit trail of which client created what (the `actor` enum is `agent|user|system`
   only).
7. **Security hardening:** Origin/CSRF check, security headers (CSP, HSTS, frame-ancestors), a real client IP
   behind Cloudflare (`CF-Connecting-IP`), mitigation for the global-lockout DoS, and pruning jobs for audit tables.
8. **Timezone correctness:** use IANA tz throughout (needed for reminders when travelling, and if Argentina ever
   reintroduces DST).
9. **iOS PWA push:** untested; needs install-to-home-screen guidance and testing on Safari 16.4+.
10. **Notifications at scale:** sending is sequential to all devices with no per-subscription failure tracking.
    Fine for one user, but fix the bookkeeping.
11. **Data migration:** none needed (the app and DB will be deleted). If any history is worth keeping, `GET
    /api/export` dumps everything as JSON before the teardown.

### 11.4 Things that would block or complicate a clean rewrite
- Nothing technical blocks it. The repo is clean, typechecks, lints, and has no hidden external dependencies.
- **Agenbot must be switched off first**, or it will keep calling `PUT /api/days/*` daily and wait for webhooks.
  Revoke by changing `AGENT_TOKEN_HASH` or tearing the app down.
- **Coolify state outside the repo:** the scheduled close-day task, env vars, R2 backup config and the Postgres
  resource must be removed or recreated by hand.
- **Installed PWA, service worker and push subscriptions** on the phone will point to the old SW (`agenda-v2`
  caches) and the old VAPID keys. If the new app reuses the same origin, ship a SW that clears old caches, and
  either reuse the VAPID keys or re-subscribe. Otherwise old subscriptions silently die.
- **WebAuthn credentials** are bound to RP ID `agenda.lemydev.com`. Re-registration is needed after the DB is
  wiped, which is expected.

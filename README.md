# Agenda

Personal, single-user, mobile-first PWA: tasks, reminders (Web Push with Listo / Posponer), events (my own plus Google
Calendar, read-only), habits, sleep and a daily review, with history and metrics. It's also the hub my AI assistant
**Sunday** (Open WebUI) reads and writes through an OpenAPI tool server.

- **App:** https://agenda.lemydev.com · **Contract:** [`openapi.yaml`](openapi.yaml) (served at `/api/openapi.json`) ·
  Sunday's tools: [`openapi.sunday.yaml`](openapi.sunday.yaml) (served at `/api/openapi.sunday.json`)
- **Stack:** Next.js 16 (App Router, React 19 + React Compiler, TypeScript strict) · Node 26 (Temporal) · PostgreSQL 18 +
  Drizzle · Zod 4 → OpenAPI 3.1 · Tailwind 4 · TanStack Query + Dexie (offline outbox) · Web Push · WebAuthn passkeys ·
  Biome · Vitest + Playwright
- v1 (the Agenbot day-plan era) is preserved as the git tag `v1`.

## Docs

| | |
|---|---|
| Set up and work on it | [`docs/v2/dev-setup.md`](docs/v2/dev-setup.md) |
| Specs | [`docs/v2/`](docs/v2/) — product, data model, architecture, API for Sunday, reminders/push, Google Calendar, security |
| Roadmap and decisions | [`docs/v2/08-roadmap-and-cutover.md`](docs/v2/08-roadmap-and-cutover.md) |
| Deploy (Coolify, from zero) | [`docs/v2/runbooks/deploy.md`](docs/v2/runbooks/deploy.md) |
| Google Calendar | [`docs/v2/runbooks/google-oauth.md`](docs/v2/runbooks/google-oauth.md) |
| Sunday | [`docs/v2/runbooks/sunday-tool-server.md`](docs/v2/runbooks/sunday-tool-server.md) · guide for the sunday repo: [`docs/v2/sunday-integration.md`](docs/v2/sunday-integration.md) |
| Backup / restore | [`docs/v2/runbooks/restore.md`](docs/v2/runbooks/restore.md) |
| Design system | [`docs/design.md`](docs/design.md) |

## Layout

```
src/
  app/        routes: (app)/… screens, api/[...path] (one dispatcher for the whole API), sw.js, manifest
  contract/   Zod schemas + route catalogue → openapi.yaml / openapi.sunday.yaml (source of truth)
  server/     db (Drizzle schema, migrations), http (router, CORS, rate limits, idempotency), auth, domain, calendar, jobs
  client/     fetch wrapper, IndexedDB cache + write outbox, queries
  ui/         components, screens
drizzle/      SQL migrations (committed)
scripts/      OpenAPI/icon generators, secrets generator, auth CLIs
tests/        unit, api (integration + contract against openapi.yaml), e2e (Playwright)
```

## Quick start

Requirements: Node 26, pnpm 11, Docker. Full guide: [`docs/v2/dev-setup.md`](docs/v2/dev-setup.md).

```bash
pnpm install
cp .env.example .env     # fill SESSION_SECRET and SETUP_CODE at least
pnpm db:up               # local Postgres 18 (agenda_dev + agenda_test)
pnpm db:migrate
pnpm dev                 # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm test` | Unit + API tests on the test database; every response is validated against `openapi.yaml` |
| `pnpm test:e2e` | Playwright on the production build |
| `pnpm typecheck` · `pnpm check` | TypeScript · Biome |
| `pnpm openapi:gen` / `openapi:check` / `openapi:lint` | Regenerate both specs / CI drift check / Redocly |
| `pnpm db:generate --name x` | New migration from the Drizzle schema (commit the SQL) |
| `pnpm secrets:gen` | Fresh production secrets for a deploy (run locally, paste into Coolify) |
| `pnpm auth:reset-pin` · `pnpm auth:recovery-codes` | In the production container: one-time PIN reset code · new recovery codes |

## Forgot the PIN

- **Recovery code:** unlock screen → *Usar código de recuperación* → new PIN (the code is consumed).
- **Server code:** in the Coolify container terminal run `pnpm auth:reset-pin`; it prints an 8-digit code valid for
  15 minutes, used in *Olvidé mi PIN → Código del servidor*.
- **New recovery codes:** Ajustes → Seguridad, or `pnpm auth:recovery-codes` in the container (invalidates the old ones).

## Working on it

`main` is the trunk and what Coolify deploys. Short branches (`feat/…`, `fix/…`, `docs/…`), PR to `main`, CI green,
merge. Working agreement for AI-assisted sessions: [`CLAUDE.md`](CLAUDE.md).

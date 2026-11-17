# 00 — Start here

## Why v2 in the same repo
Same repo, history preserved: tag the current state as `v1`, rewrite on branch `v2`, merge into `main` at cutover. We keep the solid infrastructure from v1 (contract pipeline, router, auth, push, offline client, design system, deploy) and replace the day-plan domain built for Agenbot with tasks, reminders and events built for Sunday.

## Phase 0 steps (git)
1. `git status` clean (stash or ask if not). The v2 docs (this folder and `CLAUDE.md`) are untracked at this point; they will travel with the working tree.
2. `git tag -a v1 -m "agenda v1 (Agenbot era)"` on `main` at the current commit, and `git push origin v1`.
3. `git switch -c v2`.
4. Commit the v2 docs as the first commit on `v2`.

## Delete (v1 only, not needed in v2)
- Domain: day, plan_option, block, proposal, adjustment, merge/ownership logic, webhook outbox to Agenbot, sales domain, HH:mm text times, close-day cron, hard-coded `-03:00` offset.
- Agent bearer `AGENT_TOKEN_HASH` (replaced by named API tokens).
- Generated bloat and old docs: `docs/decisions.md`, `docs/api-examples.md`, test reports, screenshots, flow/ER diagrams and old prompts under `docs/`. **Keep** `docs/agenda-audit.md` (reference) and `AGENTS.md`.
- All existing migrations (we reset to a fresh `0000`; the old DB is deleted).
- ESLint config and deps (Biome replaces it).

## Keep and port (adapt as needed)
- Contract pipeline (`src/contract`, zod-to-openapi generation, redocly lint), the catch-all API route + `src/server/http/router.ts` dispatcher, access levels.
- Idempotency keys, `bump_row_version` / `touch_updated_at` triggers, change_log for sync.
- Contract tests (ajv against the generated spec), Vitest/Playwright setup.
- Auth module: Argon2id PIN, device sessions (hashed cookie), reauth/trust windows, WebAuthn unlock (one passkey per device), recovery codes, PIN reset codes — with the security fixes in `07`.
- Push stack (VAPID at runtime, subscriptions) and the in-process worker pattern — rebuilt as the reminder scheduler in `05`.
- Offline client (Dexie + outbox sync), TanStack Query setup, hand-written service worker (new cache naming, see `07`).
- Design system "Calma": dark-first palette, mint-teal accent `oklch(.82 .08 160)`, Instrument Sans + Geist Mono, components, gestures (motion, dnd-kit), Material Symbols SVG sprite.
- Habits + streaks, sleep log.
- Dockerfile (multi-stage node:26-alpine, arm64-first), `docker/entrypoint.sh` (migrate then start), healthcheck.

## New
- Tasks with lists (Inbox), priorities, due date/time, recurrence (RRULE).
- Reminders as their own entity with a durable scheduler, catch-up and push actions.
- Events (local) + Google Calendar read-only (multiple calendars).
- Day review ("Cierre del día"), history and metrics.
- Named, scoped API tokens; AI-facing API spec for Sunday; CORS for `sunday.lemydev.com`; rate limit.
- IANA timezone + Temporal everywhere.
- Security hardening (Origin check, headers, IP handling, lockout fix, audit pruning).
- Biome + React Compiler.

## Infra facts
- Postgres: shared instance `pgvector/pgvector:pg18-trixie` in Coolify project `core`, provisioned by the **sunday** repo (its phase 1). This app uses DB `agenda` with its own user. Connection string arrives as `DATABASE_URL` in Coolify env.
- Local dev/test: Docker Postgres 18 with DBs `agenda_dev` and `agenda_test`.
- Deploy: Coolify (Oracle ARM64 VPS, Traefik, Cloudflare DNS), project `agenda`, domain `agenda.lemydev.com`, **single replica**.

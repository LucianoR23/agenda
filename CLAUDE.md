# CLAUDE.md — agenda v2

You are working in the **agenda** repo. **v2** (the rewrite, built on branch `v2`) is merged into `main` in phase 9; v1 is preserved as tag `v1`. Agenda v2 is Lemy's personal PWA at `https://agenda.lemydev.com` and the hub for tasks, reminders and events that **Sunday** (his AI assistant, Open WebUI at `https://sunday.lemydev.com`, separate repo) reads and writes through an OpenAPI API. Google Calendar is read-only. Agenbot/Grok is gone.

## Read first, in this order
1. `docs/v2/00-start-here.md` — what changes from v1, what to keep, what to delete
2. `docs/v2/01-product-spec.md` — features and screens
3. `docs/v2/02-data-model.md` — schema
4. `docs/v2/03-architecture-and-standards.md` — stack, structure, conventions
5. `docs/v2/04-api-for-sunday.md` — AI-facing API
6. `docs/v2/05-reminders-and-push.md`
7. `docs/v2/06-google-calendar.md`
8. `docs/v2/07-security-and-deploy.md`
9. `docs/v2/08-roadmap-and-cutover.md` — phases and checklists (start here for "what's next")

`docs/agenda-audit.md` is the audit of v1; use it as reference for code to port.
Also read `AGENTS.md`: **this is Next.js 16 — APIs and conventions differ from older Next.js; check `node_modules/next/dist/docs/` before writing Next-specific code.**

## Working agreement
- **Language with Lemy:** all replies, plans, summaries and questions addressed to Lemy are in Spanish (Rioplatense). Code, identifiers, commit messages and docs stay in English.
- **Plan first.** At the start of each phase, write the plan (files, migrations, commands) and **stop for Lemy's approval**. Then execute, verify (typecheck, Biome, tests, build), tick the checklist in `08-roadmap-and-cutover.md` and summarize.
- **Branches (from phase 9 on):** `main` is the trunk and what Coolify deploys. Work on a short-lived branch per change (`feat/…`, `fix/…`, `docs/…`, `chore/…`), small focused commits (English, conventional commits), push it, open a PR to `main` with `gh pr create`, wait for CI to be green, and **Lemy merges** (merge commit). Delete the branch after the merge. Never push to `main` directly, never force-push, never move or delete the `v1` tag. The `v2` branch is deleted once it's merged.
- **Tests never run against a non-test database.** The test setup must refuse to start unless the database name ends in `_test`.
- **Secrets:** never print, log or commit them. Only `.env.example` with empty values.
- Don't add dependencies without saying why; prefer what's already in the stack.
- If a doc is ambiguous or conflicts with the code/reality, stop and ask.

## Stack (v2)
Next.js 16 (App Router, standalone output, Turbopack) · React 19 with **React Compiler** · TypeScript strict · Tailwind CSS 4 (CSS-first `@theme`) · **Biome** (lint + format; ESLint removed) · pnpm · Node 26 (LTS, native Temporal) · PostgreSQL 18 · Drizzle ORM + postgres.js · Zod 4 + `@asteasolutions/zod-to-openapi` (OpenAPI 3.1 is generated from the contract) · Temporal for dates (native on Node 26; `temporal-polyfill` loaded on the client only when a browser lacks it) · TanStack Query + Dexie (offline) · web-push · @node-rs/argon2 · @simplewebauthn · Google Calendar read-only over plain `fetch` (no googleapis) + node-ical (iCal fallback) · Vitest, Playwright, ajv.

## Conventions (short; details in 03)
- Contract-first: Zod schemas in `src/contract` are the single source for validation, types and OpenAPI.
- IDs: `uuid` primary keys with PG18 `uuidv7()` default.
- Time: store `timestamptz`; the user timezone is IANA `America/Buenos_Aires` (setting, not hard-coded offsets). Use Temporal for all date math; never `new Date()` arithmetic in domain code.
- Code and identifiers in English; UI copy in Rioplatense Spanish.
- Owner: Lemy, single user. Windows + Git Bash.

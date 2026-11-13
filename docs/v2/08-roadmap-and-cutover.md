# 08 — Roadmap and cutover

One phase at a time: plan → Lemy approves → implement → gate (`typecheck`, `check`, `test`, `build`) → tick boxes → summary. ⟶ sunday marks dependencies on the sunday repo.

## Before anything (Lemy)
- [x] Agenbot/Grok switched off (no more calls to the old API/webhook) — *not switched off in Grok (account is paywalled); effectively dead because the old app and DB it called no longer exist.*
- [x] Old agenda app and old Postgres deleted in Coolify (or scheduled to be)

## Phase 0 — Branch and cleanup
- [x] Tag `v1` pushed; branch `v2` created; v2 docs committed
- [x] Old domain code, old docs, old migrations, ESLint removed (see `00`)
- [x] App still builds with a placeholder home (domain stubs OK)

> **Decision (Phase 0):** v1 habits, sleep and tasks were entangled with the day/block domain (sleep derived from the planned sleep block, tasks linked to blocks, `HH:mm` text times), so they were removed together with it instead of being stubbed. They come back rewritten against the new schema: **tasks in Phase 4**, **habits/streaks and sleep in Phase 7**. Port from tag `v1` and `docs/agenda-audit.md`. `streaks.ts` (pure logic) is kept. Hoy, Tareas, Historial and Métricas are placeholders until then. Agenbot bearer, internal token, webhook outbox and export endpoint are gone. API tests (`tests/api`) are kept but excluded from `pnpm test` until phase 2 (no migrations yet); e2e specs were v1-only and were deleted.

## Phase 1 — Tooling and foundations
- [x] Dependencies updated; Biome configured; React Compiler on; TS strict flags
- [x] Env validation with Zod; logger with redaction
- [x] Local Docker Postgres 18 (`agenda_dev`, `agenda_test`) + test DB guard
- [x] Time module (Temporal, IANA tz, injectable clock) with tests

> **Decisions (Phase 1, 2026-11-13):** Node 26 everywhere (LTS, native Temporal; Docker installs pnpm with npm because Node 25+ has no corepack). TypeScript 7 (native compiler), postgres 4 (verified with drizzle against `agenda_test`), web-push 4. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` on. Client loads `temporal-polyfill` only when Temporal is missing. **Error format:** adopt `03`'s `{ "error": { "code", "message", "details"? } }` in place of v1's RFC 9457 problem+json (implement in phase 3). With drizzle, never put a raw `Date` or array inside `sql```: use typed operators (`gte`, `arrayContains`) or ISO strings with a cast.

## Phase 2 — Schema 0000
- [ ] Drizzle schema per `02`, triggers, indexes, seeds (Inbox)
- [ ] Re-enable API tests (`tests/api`) in `pnpm test`; wire `app_user.timezone` into `formatInstant` / `userTimeZone()` (Phase 1 uses `DEFAULT_TIMEZONE`)
- [ ] Migration applies cleanly on empty DB; `uuidv7()` defaults work

## Phase 3 — Auth and security
- [ ] Setup flow, PIN, sessions, devices, WebAuthn, recovery/reset codes ported
- [ ] Origin check, headers/CSP, IP handling, new lockout, pruning
- [ ] Error envelope per `03`; auth/session/lockout/idempotency time math moved from `Date` to Temporal (`ctx.now` is still a `Date`)
- [ ] API tokens (create/revoke/list, scopes, re-auth) + Ajustes UI

## Phase 4 — Tasks
- [ ] Contract + endpoints + domain (lists, recurrence, search); pick `rrule` vs `rrule-temporal` and add RRULE helpers to `domain/time.ts`
- [ ] Screens: Hoy (tasks part), Inbox, Tareas; quick add parser; gestures; offline outbox
- [ ] **First deploy** to Coolify on `agenda.lemydev.com` (branch v2) ⟶ sunday: `DATABASE_URL` for DB `agenda` ready

## Phase 5 — Reminders and push
- [ ] Reminder entity, worker, catch-up, quiet hours, actions, failure handling
- [ ] SW rewritten (new cache scheme, actions); new VAPID; Recordatorios screen; test push

## Phase 6 — Events and Google Calendar
- [ ] Local events + offsets; Calendario screen
- [ ] Google OAuth runbook for Lemy; connect flow; sync; iCal fallback
- [ ] Overview merges everything

## Phase 7 — Habits, sleep, review, metrics
- [ ] Habits/streaks and sleep ported to new schema (removed in Phase 0; port from tag `v1`, reuse `streaks.ts`)
- [ ] Cierre del día; Historial y métricas

## Phase 8 — Sunday API
- [ ] `openapi.sunday.json` with the operations in `04`, LLM-quality descriptions
- [ ] CORS, rate limits, `client_id` upserts, `when_text`, `/api/notify`
- [ ] Contract + integration tests for Sunday flows
- [ ] Token "sunday" created ⟶ sunday: phase 4 (register tool server)

## Phase 9 — Cutover
- [ ] Merge `v2` → `main` (PR), Coolify app switched to `main`
- [ ] On each device: clear site data, open app, setup/PIN, passkey, subscribe push
- [ ] Smoke test: create by voice from Sunday → push arrives → "Listo" from the notification
- [ ] Remove anything temporary; update README to describe v2

## Later (stage 2, don't start)
`/sunday` screen with chat/voice/orb over Open WebUI's API; wake word in the PWA; Android APK.

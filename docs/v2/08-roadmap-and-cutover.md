# 08 — Roadmap and cutover

One phase at a time: plan → Lemy approves → implement → gate (`typecheck`, `check`, `test`, `build`) → tick boxes → summary. ⟶ sunday marks dependencies on the sunday repo.

## Before anything (Lemy)
- [ ] Agenbot/Grok switched off (no more calls to the old API/webhook)
- [ ] Old agenda app and old Postgres deleted in Coolify (or scheduled to be)

## Phase 0 — Branch and cleanup
- [ ] Tag `v1` pushed; branch `v2` created; v2 docs committed
- [ ] Old domain code, old docs, old migrations, ESLint removed (see `00`)
- [ ] App still builds with a placeholder home (domain stubs OK)

## Phase 1 — Tooling and foundations
- [ ] Dependencies updated; Biome configured; React Compiler on; TS strict flags
- [ ] Env validation with Zod; logger with redaction
- [ ] Local Docker Postgres 18 (`agenda_dev`, `agenda_test`) + test DB guard
- [ ] Time module (Temporal, IANA tz, injectable clock) with tests

## Phase 2 — Schema 0000
- [ ] Drizzle schema per `02`, triggers, indexes, seeds (Inbox)
- [ ] Migration applies cleanly on empty DB; `uuidv7()` defaults work

## Phase 3 — Auth and security
- [ ] Setup flow, PIN, sessions, devices, WebAuthn, recovery/reset codes ported
- [ ] Origin check, headers/CSP, IP handling, new lockout, pruning
- [ ] API tokens (create/revoke/list, scopes, re-auth) + Ajustes UI

## Phase 4 — Tasks
- [ ] Contract + endpoints + domain (lists, recurrence, search)
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
- [ ] Habits/streaks and sleep ported to new schema
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

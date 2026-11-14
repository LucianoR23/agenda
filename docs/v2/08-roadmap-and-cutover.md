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
- [x] Drizzle schema per `02`, triggers, indexes, seeds (Inbox)
- [x] Re-enable API tests (`tests/api`) in `pnpm test`
- [x] Wire `app_user.timezone` into `formatInstant` / `userTimeZone()` (done in phase 3)
- [x] Migration applies cleanly on empty DB; `uuidv7()` defaults work

> **Decisions (Phase 2, 2026-11-13):** `0000_init.sql` is pure drizzle-kit output (regenerate freely until the first deploy); `0001_db_logic.sql` (`drizzle-kit generate --custom`) holds extensions, search functions/indexes, triggers and the Inbox seed. `item_source` (`user`/`sunday`/`system`) is the actor everywhere; `change_log`/`audit_event`/`notification_log` also store `token_id`. `sleep_log.date` = wake-up date (bed after noon counts for the next day). Additions over `02`: `reminder.event_occurrence_at` (idempotent event offsets), `reminder_delivery.action/action_at` (single-use action tokens), `push_subscription.last_error`, `version`/`updated_by` on `day_review`, `api_token`/`audit_event` checks, `auth_lockout` scope `ip`. **Search:** `f_search(title, notes, …)` (lowercase + unaccent) with trigram GIN indexes on task, reminder, event and external_event; query with the same expression (`f_search(cols) LIKE '%' || f_search($1) || '%'`, or `%` for fuzzy). Functions are schema-qualified because PG17+ builds indexes with a restricted search_path.

## Phase 3 — Auth and security
- [x] Setup flow, PIN, sessions, devices, WebAuthn, recovery/reset codes ported
- [x] Origin check, headers/CSP, IP handling, new lockout, pruning
- [x] Error envelope per `03`; auth/session/lockout/idempotency time math moved from `Date` to Temporal
- [x] API tokens (create/revoke/list, scopes, re-auth) + Ajustes UI

> **Decisions (Phase 3, 2026-11-14):** Errors are `{ "error": { "code", "message", "details"?, "requestId" } }`, UPPER_SNAKE codes, Spanish messages. CSP uses a per-request nonce from `src/proxy.ts`, so `cacheComponents`/PPR are off (Next: nonces need dynamic rendering); `style-src` allows inline (React style attributes). Static security headers come from `next.config.ts`. Cookie writes require `Origin` = `APP_ORIGIN` (or `Sec-Fetch-Site: same-origin`); bodies must be JSON. Client IP: `CF-Connecting-IP` only with `TRUST_CF`, else the last `X-Forwarded-For` hop. Lockout: device + IP scopes, 5 failures → 15 min × 2ⁿ (≤ 24 h); the global counter never locks (1 s delay + one push alert per hour over 20 failures/h). Token create/revoke needs PIN/fingerprint within 5 min (`POST /api/auth/reauth`). Routes opt into tokens with `token: <scope>`. Settings (timezone etc.) via `/api/settings`, cached in memory. Worker runs a small scheduler; daily prune at 04:00 local. New Calma component `TextField`. Vitest has `unit` (no DB) and `integration` projects. CORS and per-token rate limits stay in phase 8.

## Phase 4 — Tasks
- [x] Contract + endpoints + domain (lists, recurrence, search); pick `rrule` vs `rrule-temporal` and add RRULE helpers (`domain/recurrence.ts`)
- [x] Screens: Hoy (tasks part), Inbox, Tareas; quick add parser; gestures; offline outbox
- [ ] **First deploy** to Coolify on `agenda.lemydev.com` (branch v2) ⟶ sunday: `DATABASE_URL` for DB `agenda` ready — **waiting for the `agenda` database**; steps in [`runbooks/deploy.md`](runbooks/deploy.md)

> **Decisions (Phase 4, 2026-11-14):** `rrule-temporal` pinned at 2.2.8. Completing a recurring task creates the next occurrence on the first date after both the due date and today (missed ones skipped; completing counts for today; COUNT carried down). Undo (`reopen`) removes the spawned occurrence, found through `change_log` when the client doesn't know its id (offline). Deleting a list moves its tasks to the Inbox. Task writes from the UI are optimistic through the outbox with client UUIDv7 ids; `src/client/task-cache.ts` mirrors the server views. Quick add grammar per the plan (`src/ui/quick-add.ts`). Tabs: Hoy, Inbox, Tareas, Historial, Ajustes. New Calma components: DatePicker, TimePicker, SwipeRow, TaskRow, TextArea. E2E runs the production standalone server (`scripts/e2e-server.mjs`); plain http is accepted in production only on the loopback.

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

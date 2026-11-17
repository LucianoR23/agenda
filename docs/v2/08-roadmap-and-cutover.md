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
- [x] **First deploy** to Coolify on `agenda.lemydev.com` (branch v2) ⟶ sunday: `DATABASE_URL` for DB `agenda` ready — **moved: Lemy deploys before phase 9 or as part of it** (decided 2026-11-14; `main` isn't in use meanwhile); steps in [`runbooks/deploy.md`](runbooks/deploy.md)

> **Decisions (Phase 4, 2026-11-14):** `rrule-temporal` pinned at 2.2.8. Completing a recurring task creates the next occurrence on the first date after both the due date and today (missed ones skipped; completing counts for today; COUNT carried down). Undo (`reopen`) removes the spawned occurrence, found through `change_log` when the client doesn't know its id (offline). Deleting a list moves its tasks to the Inbox. Task writes from the UI are optimistic through the outbox with client UUIDv7 ids; `src/client/task-cache.ts` mirrors the server views. Quick add grammar per the plan (`src/ui/quick-add.ts`). Tabs: Hoy, Inbox, Tareas, Historial, Ajustes. New Calma components: DatePicker, TimePicker, SwipeRow, TaskRow, TextArea. E2E runs the production standalone server (`scripts/e2e-server.mjs`); plain http is accepted in production only on the loopback.

## Phase 5 — Reminders and push
- [x] Reminder entity, worker, catch-up, quiet hours, actions, failure handling
- [x] SW rewritten (new cache scheme, actions); new VAPID; Recordatorios screen; test push — *manual check on the real devices (installed PWA on Android, Chrome/Edge on Windows) happens after the first deploy*

> **Decisions (Phase 5, 2026-11-14):** Worker ticks every 15 s and once at boot. Catch-up threshold is a setting (`app_user.missed_after_hours`, default 12, migration `0002`); quiet hours are settings too (default 23:30–07:00, editable or off) and delay non-urgent reminders without counting as late. Recurring reminders advance to the next occurrence after now; a snooze keeps the series on schedule (anchored on the delivered occurrence). Action tokens: HMAC with a key derived from `SESSION_SECRET`, 7 days, single use per occurrence. The service worker is generated by `src/app/sw.js/route.ts` (versioned cache, update on demand). Navigation: Hoy · Inbox · Tareas · Recordatorios · Más. Event-offset reminders come with events in phase 6; `/api/notify`, offset-less `fireAt` and `createTask.reminder_at` in phase 8.

## Phase 6 — Events and Google Calendar
- [x] Local events + offsets; Calendario screen
- [x] Google OAuth runbook for Lemy ([`runbooks/google-oauth.md`](runbooks/google-oauth.md)); connect flow; sync; iCal fallback — *real Google account check after the first deploy (or locally with the localhost redirect)*
- [x] Overview merges everything

> **Decisions (Phase 6, 2026-11-14):** Google over plain `fetch` (OAuth + PKCE, Calendar v3), no `googleapis` (~246 MB for six endpoints); responses validated with Zod; `node-ical` 0.27.6 for iCal (it uses `rrule-temporal`, already ours). Refresh token and iCal addresses encrypted with AES-256-GCM (`ENCRYPTION_KEY`); the iCal fetch only reaches public https hosts (redirects re-checked, 5 MB, 20 s). Sync: window −7/+120 days re-read whole; Google every 5 min, iCal every 15, exponential backoff (in memory), detached from the reminder tick; on app open when the last sync is older than 2 min; `invalid_grant` → "volver a conectar" + one push; synced events older than 30 days pruned. Google event reminders: **per calendar** (`calendar_source.reminder_minutes`, off by default) + **"Recordarme"** per event (follows the event when it moves). Local event offsets materialize as reminders 48 h ahead (job every 5 min + on every write); all-day events count back from 09:00; a cancelled one never comes back. Editing a recurring event edits the series. Navigation: Hoy · Inbox · Tareas · Calendario · Más (Recordatorios, Historial, Ajustes). Calendario: agenda view first, then week view. Hoy shows today's events from `/api/events` (offline cache like tasks); `/api/overview` is the one-call answer for Sunday. Quick add has an Evento mode. Migration `0003`. First deploy moved to "before or during phase 9".

## Phase 7 — Habits, sleep, review, metrics
- [x] Habits/streaks and sleep ported to new schema (removed in Phase 0; port from tag `v1`, reuse `streaks.ts`)
- [x] Cierre del día; Historial y métricas

> **Decisions (Phase 7, 2026-11-14):** The 21:30 "cerrá el día" push is Sunday's (phase 8, `/api/notify` → `/cierre`); Agenda only shows a "Cerrar el día" card on Hoy from 20:00. Habits: yes/no or numeric, per day or per week (Mon–Sun); paths take the id **or the slug**; a habit may carry a **task tag** (`habit.task_tag`, yes/no habits only, migration `0004`) so completing a `+gym` task checks it (source `system`) and undoing the task unchecks it. Unchecking deletes the log (soft). Archive keeps history; delete removes it. Sleep: "Me voy a dormir" / "Me levanté" + manual load; rows by wake-up date (bed from noon on → next day's row). Cierre del día: pending tasks default to **Mañana**, changeable to Inbox (not for recurring ones) or **Soltar = cancel** (a recurring one moves on to its next occurrence); mood 1–5, up to 3 highlights, note; saving again edits it. Historial y métricas are one screen (`/historial`, tabs; `/metricas` redirects): month heatmap of tasks done with a day detail (`getDaySummary`), and week/month/year metrics (tasks done, on-time rate, habit consistency, sleep averages, mood, created by hand vs Sunday). Local dates are computed in TypeScript, never `AT TIME ZONE` in SQL (the pgvector image's Postgres rejects "America/Buenos_Aires"). Habit checks are optimistic through the outbox (offline). "Más": Recordatorios · Hábitos · Historial · Ajustes.

## Phase 8 — Sunday API
- [x] `openapi.sunday.json` with the operations in `04`, LLM-quality descriptions
- [x] CORS, rate limits, `client_id` upserts, `when_text`, `/api/notify`
- [x] Contract + integration tests for Sunday flows
- [ ] Token "sunday" created ⟶ sunday: phase 4 (register tool server) — moved to phase 9b

> **Decisions (Phase 8, 2026-11-14):** Fields stay **camelCase** (`clientId`, `whenText`), like the rest of the contract; `04` updated. Sunday's spec has **37 operations**: the 20 of the first draft plus `getNow`, `reopenTask`, `getTask`, `listTaskLists`, `createTaskList`, `getReminder`, `doneReminder`, `getEvent`, `remindExternalEvent`, `listHabitLogs`, `listSleep`, `logSleepEvent`, `upsertSleep`, `getDayReview`, `saveDayReview`, `getHistory`, `getMetrics` (token scopes added to `upsertSleep`, `saveDayReview`, `getHistory`). It has no header parameters (Open WebUI would offer them to the model) and each description gets a usage note (`SUNDAY_GUIDE`). Tasks take `list` **by name**; an unknown one is a 400 listing the lists (never created, to avoid duplicates from typos). `dueDate` takes a date-time; date-times without offset are local. `clientId` = upsert (200); reused after a delete = 409. `url` deep-links open the item's sheet in the app. `/api/notify` counts its 20/24 h in `notification_log` (survives restarts); token limits (60/min, 1,000/day) are in memory. A write with no body counts as `{}` when every field is optional. `CORS_ALLOWED_ORIGINS` defaults to Sunday's origin.

## Phase 9 — Release (v2 → main, first deploy, Sunday)

> **Decision (Phase 9, 2026-11-17):** nothing was deployed yet (v1 isn't live), so there is no cutover: v2 goes to `main` and gets its first deploy. Split in 9a (now) and 9b (Sunday, a separate repo that's already built). From here on `main` is the trunk: short branches + PR + green CI, Lemy merges (`CLAUDE.md`); `v2` is deleted after the merge. `postgres-core` already exists in the Coolify project `agenda` (Ampere, arm64). Scheduled backups: decided later. The app version is stamped at build (`<package.json version>+<commit>` with Coolify's "Include Source Commit in Build", else `+build-<timestamp>`), so every deploy updates the service worker without setting `APP_VERSION`. Env values are trimmed, one pair of quotes is stripped, and unresolved `{{…}}` Coolify references stop the boot with a clear message.

### 9a — main + first deploy
- [x] README describes v2; v1 leftovers in docs cleaned
- [x] Deploy runbook complete from zero (`runbooks/deploy.md`) + `pnpm secrets:gen`
- [x] Sunday integration guide for the sunday repo (`sunday-integration.md`)
- [x] PR `v2` → `main` merged; `v2` branch deleted (2026-11-17)
- [x] Coolify app from `main` deployed and verified (health, headers, specs, CORS); version stamped from the commit
- [ ] Devices: setup/PIN, recovery codes saved, passkey, push test, PWA installed; laptop paired
- [ ] Scheduled backups of `postgres-core` (to decide)

### 9b — Sunday
- [x] Token "sunday" created; tool server registered in Open WebUI (`runbooks/sunday-tool-server.md`)
- [ ] Sunday repo updated with `sunday-integration.md` (camelCase, rules, 21:30 automation)
- [ ] Smoke test: create by voice from Sunday → push arrives → "Listo" from the notification

## Phase 10 — Overlaps and Agenda events in Google Calendar

> **Decision (2026-11-17):** Lemy wants Sunday to warn "ya tenés un evento a esa hora" and his events to show up in Google Calendar. Overlaps don't need Google writes (Google events are already synced), so they ship first (10a). Google writes (10b): a dedicated **"Agenda" calendar** in Lemy's Google account with the `calendar.app.created` scope (the app can only touch the calendar it created), **one-way** (Agenda → Google; edits made in Google are overwritten by the next change in Agenda), events copied **without Google reminders** (Agenda's pushes already notify), and on disconnect the calendar **stays** in Google.

### 10a — Overlaps
- [x] `createEvent` / `updateEvent` return `conflicts` (timed events overlapping, local + Google/iCal, recurring expanded; never blocks); a task with a time too
- [x] `checkAvailability` (`GET /api/availability`), Sunday operation #38; Sunday guide updated (hand it to the sunday repo again)
- [x] Event editor warns "Se superpone con …" from the cached day

### 10b — Agenda calendar in Google
- [x] Scope `calendar.app.created` (optional: reading keeps working without it; Ajustes asks to reconnect, which keeps the setting)
- [x] Switch "Copiar mis eventos a Google": creates (or finds again) the "Agenda" calendar, backfills from 7 days ago, excluded from the read sync
- [x] Outbox (`google_event_push`, migration `0005`): create/update/delete of local events pushed by the worker, idempotent (Google event id derived from ours), backoff, calendar re-created if deleted in Google
- [x] `/privacidad`, `06`, `02`, Google runbook (§7) updated
- [ ] Lemy: scope added in Google Cloud, reconnected, switch on, events visible in Google

## Later (stage 2, don't start)
`/sunday` screen with chat/voice/orb over Open WebUI's API; wake word in the PWA; Android APK.

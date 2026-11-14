# 04 — API for Sunday (AI-facing)

Sunday (Open WebUI) registers agenda as an **OpenAPI tool server**. Open WebUI turns each operation into a tool the model (Claude) can call. Design for an LLM caller: clear operationIds, rich descriptions, forgiving inputs, small responses, plain error messages.

## Specs
- `GET /api/openapi.json` — full spec (UI + Sunday), public, no secrets. Sunday's operations carry the extra tag `sunday`.
- `GET /api/openapi.sunday.json` — only Sunday's operations (`SUNDAY_OPERATIONS` in `src/contract/sunday.ts`). This is what Open WebUI loads. Token auth only, no header parameters (`Idempotency-Key`/`If-Match` would show up as tool arguments; `clientId` covers retries), no examples, `servers` = `APP_ORIGIN`.
- Both are generated from the Zod contract; `openapi.yaml` and `openapi.sunday.yaml` are committed, `pnpm openapi:check` fails on drift and redocly lints both in CI.
- Each Sunday operation's description = the route's description (mechanics) + a usage note for the model (`SUNDAY_GUIDE`: when to use it, what to call first or next).

## Auth
- `Authorization: Bearer agd_...` → `api_token` lookup by sha256, not revoked, not expired; scopes checked per operation (`read`, `write`, `notify`). `last_used_at`/`last_used_ip` written at most once a minute.
- The token "sunday" is created in Ajustes → Tokens de API (shown once). Registering it: `runbooks/sunday-tool-server.md`.
- Session-cookie users can also call these endpoints (the UI uses the same routes).

## Cross-cutting rules
- **Field names are camelCase** like the rest of the contract (`dueDate`, `fireAt`, `clientId`, `whenText`). *(Decision, phase 8: this doc's first draft used snake_case.)*
- **CORS:** only origins in `CORS_ALLOWED_ORIGINS` (default `https://sunday.lemydev.com`). Preflight answers methods GET/POST/PUT/PATCH/DELETE and headers `Authorization, Content-Type, Idempotency-Key, If-Match` (max-age 10 min); other origins get 403. Responses to an allowed origin carry `Access-Control-Allow-Origin` and expose `ETag, Retry-After, X-Request-Id, Idempotent-Replayed`. No credentials; cookie writes from another origin are still refused (`ORIGIN_NOT_ALLOWED`).
- **Rate limit:** per token, 60 requests/min and 1,000/day (in-memory, single replica) → 429 `RATE_LIMITED` with `Retry-After` and a Spanish message. Session calls aren't limited.
- **Idempotency:** `createTask`, `createReminder` and `createEvent` take `clientId` (≤ 100). Same `clientId` again → 200 with the existing item, updated with the fields sent that differ (version unchanged when nothing differs); a `clientId` of a deleted item → 409 "usá otro clientId". `Idempotency-Key` still works for every write.
- **Forgiving inputs:** date-times (`fireAt`, `startsAt`, `endsAt`, `reminderAt`, snooze `until`) accept ISO with or without offset; no offset = the user's wall time (`2026-11-14T09:00`). A task's `dueDate` takes `YYYY-MM-DD` or a date-time (which also sets `dueTime`). Tasks take `list` by name (case and accents ignored; an unknown name → 400 listing the existing lists, it's not created). Actions whose body fields are all optional (complete, snooze, log, done…) can be called with no body.
- **Responses:** each task, reminder and event (also every occurrence in overview/listEvents) carries `whenText` — the time in Spanish, ready to say ("jueves 14 de noviembre, 09:00", "miércoles 18 de noviembre, 10:00–11:00", "viernes 20 de noviembre (todo el día)"; the year only when it isn't this one) — and `url`, which opens it in the app (`/tareas?task=…`, `/recordatorios?reminder=…`, `/calendario?event=…` open its sheet).
- **Errors:** `{"error":{"code","message"}}` where `message` tells the model what to do ("No encontré la tarea con ese id. Usá searchAgenda para buscarla por título.").
- **Source:** items created with a token are stored with `source = 'sunday'`.

## Operations (`openapi.sunday.json`, 37)
Full descriptions live in the contract (they become the tool descriptions).

| operationId | Method / path | Scope | For the model |
|---|---|---|---|
| `getNow` | GET `/api/now` | read | Date, time, weekday, timezone, offset, tomorrow and this week (Mon–Sun). Before resolving relative dates. |
| `getAgendaOverview` | GET `/api/overview?from&to` | read | Everything in a range (default today, ≤ 31 days): local + Google events, tasks due, reminders, overdue tasks. |
| `searchAgenda` | GET `/api/search?q&types&includeDone` | read | Find tasks, reminders and local events by text, to get an id. |
| `listTasks` / `getTask` | GET `/api/tasks`, `/api/tasks/{id}` | read | Views (today, overdue, upcoming, inbox, done) and filters. |
| `createTask` | POST `/api/tasks` | write | title, notes, dueDate (date or date-time), dueTime, priority, `list` (name) or listId, tags, rrule, `reminderAt`, `clientId`. Returns the task (+ `reminder`). |
| `updateTask` | PATCH `/api/tasks/{id}` | write | Reschedule, rename, move (`list`), cancel. |
| `completeTask` / `reopenTask` | POST `/api/tasks/{id}/complete`, `/reopen` | write | Done (recurring → `next`) and undo. |
| `deleteTask` | DELETE `/api/tasks/{id}` | write | Soft delete. |
| `listTaskLists` / `createTaskList` | GET/POST `/api/lists` | read/write | List names for `list`. |
| `listReminders` / `getReminder` | GET `/api/reminders?view`, `/api/reminders/{id}` | read | `view=upcoming` / `recent`. |
| `createReminder` | POST `/api/reminders` | write | title, body, fireAt, rrule, urgent, taskId, `clientId`. |
| `updateReminder` / `snoozeReminder` / `doneReminder` / `deleteReminder` | `/api/reminders/{id}[/snooze\|/done]` | write | Move, postpone (minutes or until), Listo, cancel. |
| `listEvents` / `getEvent` | GET `/api/events?from&to&includeExternal`, `/api/events/{id}` | read | Local + Google (≤ 92 days); Google ones `readOnly: true`. |
| `createEvent` / `updateEvent` / `deleteEvent` | `/api/events[/{id}]` | write | Local events only; Google → 409 `READ_ONLY_EVENT`. `clientId` on create. |
| `remindExternalEvent` | POST `/api/external-events/{id}/remind` | write | "Recordarme" for a Google event. |
| `listHabits` / `listHabitLogs` | GET `/api/habits?date`, `/api/habits/{habit}/logs` | read | Status, progress, streaks, history. |
| `logHabit` | POST `/api/habits/{habit}/log` | write | `{habit}` = id or slug (`gym`); numeric ones take `value`. |
| `listSleep` / `logSleepEvent` / `upsertSleep` | `/api/sleep…` | read/write | "Me voy a dormir" / "Me levanté", or a whole night with quality. |
| `getDaySummary` | GET `/api/summary/day?date` | read | Done/pending tasks, habits, sleep and review of a day. |
| `getDayReview` / `saveDayReview` | GET/PUT `/api/reviews/{date}` | read/write | Close the day: mood, highlights, note, moves for pending tasks. |
| `getHistory` / `getMetrics` | GET `/api/history?month`, `/api/metrics?range&date` | read | Per-day month numbers; week/month/year trends. |
| `sendPushNotification` | POST `/api/notify` | notify | Push now: title (≤ 60), body (≤ 240), `url` (https on the app's or Sunday's host, or an app path), tag. 20 per rolling 24 h (counted in `notification_log`, survives restarts). |

App-only (not in Sunday's spec): auth, devices, tokens, settings, calendars admin, habit setup, reorder, history of pushes.

## Acceptance
- `openapi.sunday.json` validates (redocly) and imports into Open WebUI; tools appear with sensible names. *(Import: phase 9, after the deploy.)*
- `tests/api/sunday.test.ts`: the spec's shape, getNow, clientId upserts, forgiving inputs, notify (+ limit), rate limit, CORS. Every response in every API test is validated against `openapi.yaml` with ajv.
- `tests/api/sunday-flows.test.ts`: a day of Sunday calls through the token only (¿qué tengo hoy?, create with retry, search → reschedule, recurring done/undo, reminders, events incl. Google read-only + Recordarme, habits by slug and tag, sleep, evening summary → close the day → push, history, metrics); its last test fails unless all 37 operations were called and matched the contract.

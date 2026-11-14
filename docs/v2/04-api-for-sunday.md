# 04 — API for Sunday (AI-facing)

Sunday (Open WebUI) registers agenda as an **OpenAPI tool server**. Open WebUI turns each operation into a tool the model (Claude) can call. Design for an LLM caller: clear operationIds, rich descriptions, forgiving inputs, small responses, plain error messages.

## Specs
- `GET /api/openapi.json` — full spec (UI + Sunday), public, no secrets.
- `GET /api/openapi.sunday.json` — only operations tagged `sunday`. This is what Open WebUI loads. Keep it small: no auth/device/settings endpoints.
- OpenAPI 3.1 generated from the Zod contract; lint with redocly in CI.

## Auth
- `Authorization: Bearer agd_...` → `api_token` lookup by sha256, not revoked, not expired; scopes checked per operation (`read`, `write`, `notify`). Update `last_used_at`/`last_used_ip` (throttled to once per minute).
- The token "sunday" is created in Ajustes → Tokens de API (shown once).
- Session-cookie users can also call these endpoints (the UI uses the same routes).

## Cross-cutting rules
- **CORS:** allow only origins in `CORS_ALLOWED_ORIGINS` (default `https://sunday.lemydev.com`), methods GET/POST/PATCH/DELETE, headers `Authorization, Content-Type, Idempotency-Key`. No credentials for token calls. (Global tool servers in Open WebUI call server-side, but user-level ones call from the browser — CORS covers both.)
- **Rate limit:** per token, 60 requests/min and 1,000/day (in-memory, single replica); 429 with a readable message.
- **Idempotency:** creates accept `client_id` (string ≤ 100). Same `client_id` again → returns the existing item with 200 (upsert semantics: if fields differ, update them). Also honour `Idempotency-Key`.
- **Forgiving inputs:** accept `due` as `YYYY-MM-DD` or ISO datetime; accept `fire_at` with or without offset (no offset = user timezone). Reject truly ambiguous input with a message that says what's missing.
- **Responses:** compact. Each item includes `id`, `title`, the relevant time fields both as ISO and as a human string in Spanish (`when_text`: "jueves 14 de noviembre, 09:00"), and `url` to open it in the app.
- **Errors:** `{"error":{"code","message"}}` where `message` tells the model what to do ("No encontré la tarea con ese id. Usá searchAgenda para buscarla por título.").
- **Source:** items created with a token are stored with `source = 'sunday'`.

## Operations (tag `sunday`)
Descriptions below are the spirit; write full descriptions in the contract (they become the tool descriptions).

| operationId | Method / path | Scope | Description for the model |
|---|---|---|---|
| `getNow` | GET `/api/now` | read | Current date, time, weekday and timezone of the user. Call before resolving relative dates if unsure. |
| `getAgendaOverview` | GET `/api/overview?from&to` | read | Everything in a date range (default today): local events, Google Calendar events (read-only), tasks due, reminders. Sorted chronologically, plus overdue tasks. Use for "¿qué tengo hoy/mañana/esta semana?". Max range 31 days. |
| `searchAgenda` | GET `/api/search?q&types&include_done` | read | Find tasks, reminders and events by text. Use to get an id before updating/deleting. |
| `listTasks` | GET `/api/tasks?status&list&due_from&due_to&tag&limit` | read | List tasks with filters. |
| `createTask` | POST `/api/tasks` | write | Create a task. Without date → Inbox. Fields: title, notes, due_date, due_time, priority, list (name), tags, rrule, client_id, reminder_at (optional: also creates a reminder). |
| `updateTask` | PATCH `/api/tasks/{id}` | write | Change any field (reschedule, rename, move list). |
| `completeTask` | POST `/api/tasks/{id}/complete` | write | Mark done (creates next occurrence if recurring). |
| `deleteTask` | DELETE `/api/tasks/{id}` | write | Delete (soft). Prefer completing if it was done. |
| `listReminders` | GET `/api/reminders?status&from&to` | read | Upcoming or past reminders. |
| `createReminder` | POST `/api/reminders` | write | Push notification at `fire_at`. Fields: title, body, fire_at, rrule, urgent, task_id, event_id, client_id. |
| `updateReminder` | PATCH `/api/reminders/{id}` | write | Change time/text. |
| `snoozeReminder` | POST `/api/reminders/{id}/snooze` | write | Postpone by minutes or until a time. |
| `deleteReminder` | DELETE `/api/reminders/{id}` | write | Cancel. |
| `listEvents` | GET `/api/events?from&to&include_google` | read | Local and Google events in a range. Google ones have `source: "google"`, `read_only: true`. |
| `createEvent` | POST `/api/events` | write | Local event: title, starts_at/ends_at or all-day dates, location, notes, rrule, reminder_offsets (minutes before), client_id. |
| `updateEvent` | PATCH `/api/events/{id}` | write | Local events only; Google events return a clear "read-only" error. |
| `deleteEvent` | DELETE `/api/events/{id}` | write | Local events only. |
| `listHabits` | GET `/api/habits?date` | read | Habits with today's status and streaks. |
| `logHabit` | POST `/api/habits/{habit}/log` | write | Check (or uncheck) a habit for a date; `{habit}` is the id or the slug (`gym`). Numeric habits take `value`. |
| `getDaySummary` | GET `/api/summary/day?date` | read | Done/pending tasks, habits, sleep, review for a day (for the evening review automation). |
| `sendPushNotification` | POST `/api/notify` | notify | Push to Lemy's devices: title (≤ 60), body (≤ 240), url (optional, must be https on `sunday.lemydev.com` or `agenda.lemydev.com`), tag. Rate-limited to 20/day. |

## Acceptance
- `openapi.sunday.json` validates and imports into Open WebUI; tools appear with sensible names.
- Contract tests cover every operation; ajv validates responses.
- An integration test simulates the Sunday flows listed in the sunday repo (`docs/05-agenda-integration.md` §Tests).

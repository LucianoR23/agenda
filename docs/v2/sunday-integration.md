# Integrating Sunday with Agenda — guide for the Sunday repo

**For:** whoever works on the **sunday** repo (Claude Code or a person). This file is self-contained: copy it into
the sunday repo (e.g. `docs/agenda-api.md`). The machine-readable source of truth is the live spec
`https://agenda.lemydev.com/api/openapi.sunday.json` (also committed in the agenda repo as `openapi.sunday.yaml`);
if this guide and the spec ever disagree, the spec wins.

## 1. What Agenda is and how Sunday uses it

Agenda (`https://agenda.lemydev.com`) is Lemy's personal PWA: tasks, reminders (push notifications), events (his own
plus Google Calendar, read-only), habits, sleep and a daily review. Sunday reads and writes it through an
**OpenAPI tool server**: Open WebUI loads the spec and every operation becomes a tool the model can call. Nothing has
to be coded in Sunday for that part, only configured (§3).

Two kinds of integration:

1. **Tools in chat/voice** — Open WebUI calls the API when the model decides ("anotá…", "¿qué tengo mañana?").
2. **Automations** — scheduled jobs on Sunday's side (if Sunday has a scheduler/pipelines) that call the API
   directly over HTTP with the same token: e.g. the 21:30 "cerrá el día" push (§7).

## 2. Connection

| | |
|---|---|
| Base URL | `https://agenda.lemydev.com` (all paths start with `/api/`) |
| Spec for Open WebUI | `GET /api/openapi.sunday.json` (public, no auth) — 38 operations |
| Auth | `Authorization: Bearer agd_…` — the API token named **sunday**, scopes `read`, `write`, `notify`. Lemy creates it in Agenda → Ajustes → Tokens de API; it's shown once. Keep it in Open WebUI's tool server config / Sunday's secrets, never in the repo. |
| Content type | `application/json` both ways |
| Timezone | `America/Buenos_Aires`; every timestamp in responses carries its offset (`2026-11-19T09:00:00.000-03:00`) |
| CORS | browser calls allowed only from `https://sunday.lemydev.com` (for user-level tool servers). Server-side calls don't need it. |
| Limits | per token 60 requests/min and 1,000/day → `429 RATE_LIMITED` + `Retry-After`. `/api/notify`: 20 per rolling 24 h. |

## 3. Registering the tool server in Open WebUI

Admin Panel → Settings → **External Tools** (older versions: Settings → Tools → Tool Servers) → add:

- URL `https://agenda.lemydev.com`, OpenAPI spec path `api/openapi.sunday.json`
- Auth: Bearer, key = the `agd_…` token
- Name `Agenda`, description "Tareas, recordatorios, eventos, hábitos y sueño de Lemy"

Prefer a **global** (admin) tool server: Open WebUI's backend calls Agenda server-side. Check that tools such as
`getNow`, `createTask` and `getAgendaOverview` appear. If Sunday is configured as code (e.g. env vars or a
provisioning script for Open WebUI), add it there instead of clicking.

## 4. Conventions the model (and any code) must follow

- **Field names are camelCase:** `dueDate`, `dueTime`, `fireAt`, `startsAt`, `clientId`, `whenText`. *(An early draft
  of this API used snake_case — `due_date`, `fire_at`, `client_id`, `when_text`, `include_google` — if the sunday
  repo's docs or prompts say that, update them.)*
- **Relative dates:** call `getNow` when unsure what day it is; it returns `date`, `weekday`, `tomorrow`,
  `weekStart`/`weekEnd`.
- **Times without offset are Lemy's local time:** `"2026-11-19T09:00"` means 09:00 in Buenos Aires. Offsets are also
  accepted.
- **Ids before changes:** to update/complete/delete something named by title, `searchAgenda?q=…` first (tasks,
  reminders, Lemy's own events). Google events come from `getAgendaOverview` / `listEvents`.
- **Idempotent creates:** send a `clientId` (your own string ≤ 100, e.g. `sunday-<conversation>-<n>`) on
  `createTask`, `createReminder`, `createEvent`. Retrying with the same `clientId` returns the existing item with
  **200** (updated with any changed fields) instead of a duplicate (201 = newly created).
- **Read back with `whenText`:** every task, reminder and event carries `whenText` ("jueves 19 de noviembre, 09:00",
  "miércoles 18 de noviembre, 10:00–11:00", "viernes 20 de noviembre (todo el día)") and `url` (opens it in the app;
  safe to show as a link).
- **Errors:** `{"error":{"code":"…","message":"…","details"?:{…},"requestId":"…"}}`. `message` is Spanish and says
  what to do next ("No encontré la tarea con ese id. Usá searchAgenda para buscarla por título."); it can be shown
  or acted on. Codes worth handling: `VALIDATION_ERROR` (400, `details.fields`), `NOT_FOUND` (404),
  `READ_ONLY_EVENT` (409: a Google event can't be changed), `VERSION_CONFLICT` (409), `INSUFFICIENT_SCOPE` (403),
  `UNAUTHORIZED` (401: token wrong/revoked), `RATE_LIMITED` (429).
- **Overlaps:** `createEvent` and `updateEvent` return `conflicts`: the timed events (Lemy's own and Google's) that
  overlap the one just saved; a task with a time returns `conflicts` too. The write is never blocked: if the list
  isn't empty, tell Lemy ("Listo, aunque ojo: a esa hora ya tenés la daily") and offer to move it; don't move it on
  your own. To check before proposing a time, or for "¿tengo algo el jueves a las 15?", use `checkAvailability`.
- Everything created with the token is stored as `source: "sunday"` (Lemy sees it in Métricas).

## 5. Operations

`*` = required. Scope in brackets. Bodies are JSON; actions whose body fields are all optional can be called with no
body.

**Context**

| Tool | Call | Use |
|---|---|---|
| `getNow` [read] | `GET /api/now` | Today, time, weekday, week. |
| `getAgendaOverview` [read] | `GET /api/overview?from&to` | Everything in a range (default today, ≤ 31 days, `to` inclusive): `events` (local + Google), `tasks` due, `reminders`, `overdue`. The first call for "¿qué tengo…?". |
| `searchAgenda` [read] | `GET /api/search?q*&includeDone&limit` | Find by text → `results[]` of `{type: task\|reminder\|event, …}`. |

**Tasks**

| Tool | Call | Use |
|---|---|---|
| `listTasks` [read] | `GET /api/tasks?view&listId&tag&status&dueFrom&dueTo&q&limit` | `view`: today, overdue, upcoming, inbox, done, all. |
| `getTask` [read] | `GET /api/tasks/{id}` | |
| `createTask` [write] | `POST /api/tasks` `{title*, notes, dueDate, dueTime, list, listId, priority, tags, rrule, reminderAt, clientId}` | No date → Inbox. `dueDate` = `YYYY-MM-DD` or a date-time (sets the time too). `list` = list name (must exist). `priority` 0–3. `rrule` like `FREQ=WEEKLY;BYDAY=MO` (needs a date). `reminderAt` also schedules a push; the response then includes `reminder`. |
| `updateTask` [write] | `PATCH /api/tasks/{id}` `{title, notes, dueDate, dueTime, list, listId, priority, tags, rrule, status}` | Only the fields that change. `dueDate: null` clears date/time/recurrence. `status: "cancelled"` = won't do it. |
| `completeTask` [write] | `POST /api/tasks/{id}/complete` | Recurring → response `next` (the next occurrence). |
| `reopenTask` [write] | `POST /api/tasks/{id}/reopen` | Undo a completion. |
| `deleteTask` [write] | `DELETE /api/tasks/{id}` | Only on explicit request. |
| `listTaskLists` / `createTaskList` [read/write] | `GET/POST /api/lists` `{name*}` | |

**Reminders** (a push at a moment)

| Tool | Call | Use |
|---|---|---|
| `listReminders` [read] | `GET /api/reminders?view&status&from&to&limit` | `view=upcoming` (pending) or `recent`. |
| `getReminder` [read] | `GET /api/reminders/{id}` | |
| `createReminder` [write] | `POST /api/reminders` `{title*, fireAt*, body, rrule, urgent, taskId, clientId}` | `fireAt` in the future. `urgent` ignores quiet hours. |
| `updateReminder` [write] | `PATCH /api/reminders/{id}` `{title, body, fireAt, rrule, urgent, taskId}` | A new time re-arms one that fired. |
| `snoozeReminder` [write] | `POST /api/reminders/{id}/snooze` `{minutes \| until}` | Default: Lemy's snooze setting. |
| `doneReminder` / `deleteReminder` [write] | `POST /api/reminders/{id}/done`, `DELETE /api/reminders/{id}` | Listo (completes a linked task) / cancel. |

**Events**

| Tool | Call | Use |
|---|---|---|
| `listEvents` [read] | `GET /api/events?from*&to*&includeExternal` | ≤ 92 days. Google ones: `source: "google"`, `readOnly: true`, use `externalEventId`. |
| `checkAvailability` [read] | `GET /api/availability?from*&to*` | Is a slot free? `free`, `busy` (timed events overlapping [from, to), Google included) and `allDay` (that day's all-day events, as context). ≤ 31 days. |
| `getEvent` [read] | `GET /api/events/{id}` | Local events. |
| `createEvent` [write] | `POST /api/events` `{title*, startsAt, endsAt, allDay, startDate, endDate, location, notes, rrule, reminderOffsets, clientId}` | Timed (`startsAt` [+ `endsAt`]) or all-day (`allDay: true`, `startDate` [+ exclusive `endDate`]). `reminderOffsets: [60, 15]` = pushes 60 and 15 min before. Created in Agenda; if Lemy turned on the copy, it also shows up in an "Agenda" calendar in his Google Calendar (one way: always change it through Agenda). The response adds `conflicts` (overlapping events): mention them. |
| `updateEvent` / `deleteEvent` [write] | `PATCH/DELETE /api/events/{id}` | Local only; Google → 409 `READ_ONLY_EVENT` (tell Lemy to change it in Google Calendar). `updateEvent` returns `conflicts` too. |
| `remindExternalEvent` [write] | `POST /api/external-events/{id}/remind` `{minutesBefore \| at}` | "Avisame 10 min antes de la daily" for a Google event. |

**Habits, sleep, the day**

| Tool | Call | Use |
|---|---|---|
| `listHabits` [read] | `GET /api/habits?date` | Each habit with `slug`, today's `log`, `period` progress, `streak`. |
| `logHabit` [write] | `POST /api/habits/{habit}/log` `{date, done, value}` | `{habit}` = slug (`gym`) or id. Yes/no: no body = check, `done: false` = uncheck. Numeric: `value`. |
| `listHabitLogs` [read] | `GET /api/habits/{habit}/logs?from*&to*` | |
| `listSleep` [read] | `GET /api/sleep?from*&to*` | Nights, keyed by wake-up date. |
| `logSleepEvent` [write] | `POST /api/sleep/events` `{type*: bed\|wake, at}` | "Me voy a dormir" / "Me levanté". |
| `upsertSleep` [write] | `PUT /api/sleep/{date}` `{bedAt, wakeAt, quality 1–5, notes}` | A whole night by hand. |
| `getDaySummary` [read] | `GET /api/summary/day?date` | Done / pending / overdue tasks, habits, sleep, review of a day. |
| `getDayReview` / `saveDayReview` [read/write] | `GET/PUT /api/reviews/{date}` `{mood 1–5, highlights ≤ 3, note, moves: [{taskId, to: tomorrow\|inbox\|drop}]}` | Close the day; `drop` = cancel. |
| `getHistory` / `getMetrics` [read] | `GET /api/history?month=YYYY-MM`, `GET /api/metrics?range=week\|month\|year&date` | Numbers and trends. |

**Push**

| Tool | Call | Use |
|---|---|---|
| `sendPushNotification` [notify] | `POST /api/notify` `{title* ≤ 60, body* ≤ 240, url, tag}` | Push to Lemy's devices now. `url`: https on `sunday.lemydev.com`/`agenda.lemydev.com`, or an app path like `/cierre`. Same `tag` replaces the previous one. Response `{delivered, failed, remainingToday}`; `delivered: 0` = no device online/subscribed. For a later time use `createReminder`. |

## 6. Example exchanges

"Recordame mañana a las 9 llamar al contador" (getNow said today is 2026-11-18):

```http
POST /api/tasks
Authorization: Bearer agd_…
Content-Type: application/json

{"title":"Llamar al contador","dueDate":"2026-11-19T09:00","reminderAt":"2026-11-19T09:00","clientId":"sunday-c42-1"}
```

```json
201 {"id":"019a…","title":"Llamar al contador","dueDate":"2026-11-19","dueTime":"09:00",
     "whenText":"jueves 19 de noviembre, 09:00","url":"https://agenda.lemydev.com/tareas?task=019a…",
     "source":"sunday", "...": "...",
     "reminder":{"id":"019b…","fireAt":"2026-11-19T09:00:00.000-03:00","whenText":"jueves 19 de noviembre, 09:00", "...": "..."}}
```

"Pasá lo del contador al viernes": `GET /api/search?q=contador` → take the task's `id` →
`PATCH /api/tasks/{id}` `{"dueDate":"2026-11-20"}`.

"¿Qué tengo mañana?": `GET /api/overview?from=2026-11-19` → read `events`, `tasks`, `reminders` with their
`whenText`; mention `overdue` if not empty.

## 7. Automations (Sunday's side)

Suggested, all with the same token over plain HTTP:

| When | What | Calls |
|---|---|---|
| Daily 21:30 | "Cerrá el día" nudge — Agenda shows a "Cerrar el día" card from 20:00 but sends no push itself | `GET /api/reviews/{today}`; if `review` is null → `POST /api/notify` `{"title":"Cerrá el día","body":"…","url":"/cierre","tag":"cierre"}` |
| Evening (optional) | Summary of the day | `GET /api/summary/day` → compose → `POST /api/notify` (`tag: "resumen"`) |
| Morning (optional) | Brief | `GET /api/overview` (+ `GET /api/now`) → message in Sunday or a push |

Keep automations within the limits (20 pushes per 24 h shared by everything Sunday sends).

## 8. Checklist to call it done

- [ ] Token `sunday` created in Agenda (read, write, notify) and stored only in Open WebUI / Sunday's secrets.
- [ ] Tool server registered; the 38 tools are listed.
- [ ] Sunday's prompts/docs use camelCase and the rules of §4 (getNow, search before change, clientId, whenText).
- [ ] From a chat: "¿qué día es?" → `getNow`; "anotá X mañana a las 9 y recordámelo" → task + reminder visible in
      Agenda with source Sunday; "¿qué tengo mañana?" → overview; "mandame una notificación de prueba" → push arrives.
- [ ] By voice: create something → its push arrives at the time → "Listo" from the notification marks it done.
- [ ] The 21:30 automation sends the push only when the day isn't closed.

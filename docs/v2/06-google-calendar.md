# 06 — Google Calendar (read + Agenda's own calendar)

> **Implemented in phase 6** with plain `fetch` (no `googleapis`: ~246 MB for six endpoints) — `src/server/calendar/`
> (`google.ts` OAuth/API with Zod-validated responses, `ical.ts`, `sync.ts`, `service.ts`, `secretbox.ts`).
> **Phase 10b** adds copying Agenda's events to Google (`push.ts`): see "Agenda → Google" below. Reading stays as is.

## Situation
Lemy has a work Google Workspace account and a personal calendar. The work account only allowed sharing free/busy, so he shared his **personal** calendar **into** the work account with full details. Therefore **one OAuth login with the work account sees both calendars**.

Risk: the Workspace admin may block third-party OAuth apps. Plan B is the secret iCal address of each calendar (no OAuth). Build both; OAuth is primary.

## OAuth setup (Lemy does the Google Cloud part: [`runbooks/google-oauth.md`](runbooks/google-oauth.md))
1. Google Cloud project (under the Workspace org if he's allowed; otherwise a personal project).
2. Enable **Google Calendar API**.
3. OAuth consent screen: user type **Internal** if the project belongs to the Workspace org (no verification, tokens don't expire). If **External**, publish the app to **In production** (unverified is fine for one user; he'll see a warning). Don't leave it in *Testing*: refresh tokens expire after 7 days there.
4. OAuth client "Web application", redirect URI `https://agenda.lemydev.com/api/google/callback` (plus `http://localhost:3000/api/google/callback` for dev).
5. Scopes: `https://www.googleapis.com/auth/calendar.readonly` (read) and `https://www.googleapis.com/auth/calendar.app.created` (phase 10b: create one calendar and manage only what the app created). A connection made before 10b has only the first: reading works, Ajustes asks to reconnect to copy events.
6. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Coolify env.

## Flow
- Ajustes → Google Calendar → "Conectar" → `GET /api/google/connect` (user session) → Google consent (`access_type=offline`, `prompt=consent`, PKCE + `state` in an HMAC cookie) → `/api/google/callback` stores the **encrypted refresh token** (`google_credential`, AES-256-GCM, `ENCRYPTION_KEY`).
- Then list calendars (`calendarList.list`) and let Lemy pick which to show (work + shared personal; maybe holidays). Save as `calendar_source` rows with name/color.
- "Desconectar" revokes the token at Google and deletes the credential and external events.

## Sync
Windowed polling (simple and robust for one user):
- Every 5 min (and on demand with a "Sincronizar" button / on app open if last sync > 2 min): for each enabled source, `events.list` with `singleEvents=true`, `timeMin = now − 7 d`, `timeMax = now + 120 d`, `showDeleted=true`, paginated.
- Upsert into `external_event` by `(source_id, external_id)`; delete rows in the window not returned (or returned as cancelled).
- Store `etag`/`updated` to skip unchanged rows. `syncToken`-based incremental sync is an optional later optimization (it can't be combined with time windows, so keep windowed as the base).
- Errors: `invalid_grant` → mark disconnected, push a notice "Google Calendar desconectado, volvé a conectar". 403 from admin policy → show the iCal fallback instructions. Back off on 429/5xx.

## iCal fallback
- Per calendar, paste the "Secret address in iCal format" (stored encrypted in `calendar_source.ical_url_enc`).
- Fetch every 15 min, parse with `node-ical` (expand RRULEs within the same window, honour EXDATE/RECURRENCE-ID), same upsert/delete logic.

## Exposure
- Overview, Calendario and `listEvents` merge local `event` and `external_event`; external ones are flagged `source: "google" | "ical"`, `read_only: true`, with `html_link`.
- Reminders for Google events (decided in phase 6): **per calendar** `calendar_source.reminder_minutes` (default off: Google already notifies), materialized like local event offsets; plus **"Recordarme"** on a single event (`POST /api/external-events/{id}/remind`, `minutesBefore` follows the event when it moves, or a fixed `at` for all-day events).

## Agenda → Google (phase 10b)
Decided 2026-11-17: Lemy's own events (also the ones Sunday creates) appear in Google Calendar, in a calendar of their own.
- **Switch** Ajustes → Google Calendar → "Copiar mis eventos a Google" (`PATCH /api/google {copyEvents}`). On first use the app creates a secondary calendar **"Agenda"** (Lemy's timezone; its description carries a marker `[agenda:<host>]` so a reconnect finds it again instead of creating another).
- **One way.** Agenda is the source: each create/update/delete of a local event is written to Google; edits made in Google are overwritten by the next change in Agenda. The "Agenda" calendar is excluded from the read sync (no event twice).
- **Outbox without a queue table of jobs:** `google_event_push` keeps the version last written per event; the worker (every minute, never overlapping itself, 50 per pass) writes what's pending — live events changed since (recurring ones, or ending within the last 7 days) and deletions of copied ones. The Google event id is our uuid without dashes (valid base32hex), so retries are idempotent: insert → 409 means update; update → 404 means insert; insert → 404 means the calendar was deleted in Google (it's created again and everything copied).
- **Mapping:** title, notes (description), location; timed → `dateTime` + the event's `timeZone`, no end → zero length; all-day → `date` with the exclusive end; RRULE → `recurrence`. `reminders: {useDefault: false}`: Agenda's own pushes notify (no double alerts). `extendedProperties.private.agendaEventId`.
- **Failures:** a rejected event is retried with backoff (2, 4, 8 … min, at most a day) and counted in Ajustes; `invalid_grant` marks the connection like the sync does; 429/5xx stop the pass until the next minute.
- **Turning it off** stops copying; **disconnecting** forgets what was copied locally. In both cases the "Agenda" calendar stays in Google (Lemy deletes it there if he wants).

## Tests
- Fake Google transport (`setGoogleFetch`): initial sync, update, deletion/cancel, pagination, invalid_grant, 403.
- iCal parser with recurring event + exception fixture.
- Encryption round-trip; token never appears in logs or responses.

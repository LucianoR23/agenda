# 01 — Product spec

Single user (Lemy). Mobile-first PWA, also used on Windows desktop/laptop. UI in Rioplatense Spanish. Design system "Calma" (dark-first). Fast, calm, few taps.

## Concepts
- **Task**: something to do. Lives in a list (default **Inbox**). Optional due date, optional due time, priority (0–3), notes, tags, recurrence (RRULE). Status open / done / cancelled.
- **Reminder**: a push notification at a moment. Standalone ("recordame llamar al contador a las 9") or attached to a task/event. Optional recurrence. Actions from the notification: **Listo** and **Posponer** (10 min default; 1 h; mañana 9:00).
- **Event**: something that happens at a time (start/end or all-day), with location/notes, optional recurrence and reminder offsets (e.g. 30 and 10 min before). Local events are editable; **Google events are read-only** and visually marked.
- **Habit**: daily/weekly target with check-ins and streaks (from v1).
- **Sleep log**: bed/wake times and quality (from v1).
- **Day review** ("Cierre del día"): end-of-day note, mood 1–5, highlights, what moves to tomorrow.
- **Source**: every item records who created it (`user` or `sunday`) for history.

## Screens
1. **Hoy** (home): chronological timeline for today — events (local + Google), tasks with time, reminders; then tasks due today without time; overdue section; habit checks; quick sleep log in the morning. Big "+" quick add (natural text: "mañana 9 llamar contador" → parsed locally to a task/reminder, editable before saving). Swipe right = done, swipe left = snooze/reschedule.
2. **Inbox**: undated tasks, fast triage (assign date, list, priority; drag to reorder).
3. **Tareas**: lists, filters (today, upcoming, overdue, by tag, done), search.
4. **Calendario**: agenda view (default on mobile) and week view; local + Google events; tap a free slot to create.
5. **Recordatorios**: upcoming and recent (sent, done, missed), with status.
6. **Hábitos**: today's checks, streaks, history heatmap.
7. **Historial y métricas**: completed tasks per day/week, on-time rate, habit consistency, sleep averages, items created by Sunday vs by hand. Simple charts.
8. **Cierre del día**: guided review (done today, pending → move to tomorrow / inbox / drop, mood, note). Opened from the 21:30 Sunday push too.
9. **Ajustes**: seguridad (PIN, passkeys, recovery codes, devices/sessions), notificaciones (subscribe this device, test push, quiet hours), Google Calendar (connect, choose calendars, last sync, errors), **tokens de API** (create named token with scopes, shown once, revoke, last used), zona horaria, app version.

## Behaviour
- Recurring tasks: completing one creates the next occurrence from the RRULE (in the user timezone, DST-safe even though Argentina has no DST today).
- Overdue tasks stay visible until done/rescheduled; nothing silently disappears.
- Quiet hours (default 23:30–07:00): reminders inside them are delivered at the end of quiet hours unless marked urgent.
- Offline: browsing cached data, creating/completing tasks and logging habits work offline (outbox sync); conflicts resolved by row `version` (last write wins with a toast if the server version changed).
- Everything Sunday can do through the API, Lemy can do in the UI.

## Out of scope (v2)
Multi-user, sharing, writing to Google, Keep/Google Tasks import, iOS-specific push work, the Sunday chat screen (that's stage 2, later).

## Stage 2 hook (don't build yet)
Reserve the route `/sunday` and a nav slot. Later it hosts the Sunday chat/voice screen with the "galaxy" orb, talking to Open WebUI's API. CSP must be easy to extend to `https://sunday.lemydev.com` and microphone permission (`Permissions-Policy: microphone=(self)`).

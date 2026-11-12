# 05 — Reminders and push

## Worker
In-process loop started once per server process (skip when `DISABLE_WORKER=true`). Single replica is a requirement (documented in `07`). Tick every 15 s:

```sql
BEGIN;
SELECT * FROM reminder
 WHERE status = 'scheduled' AND deleted_at IS NULL AND fire_at <= now()
 ORDER BY fire_at
 LIMIT 50
 FOR UPDATE SKIP LOCKED;
-- for each: INSERT reminder_delivery (reminder_id, occurrence_at = fire_at) ON CONFLICT DO NOTHING
-- if inserted: send push; then
--   one-off  → status = 'sent', last_fired_at = now()
--   rrule    → fire_at = next occurrence after now (Temporal, user tz), stays 'scheduled'
COMMIT;
```
`SKIP LOCKED` + the unique `(reminder_id, occurrence_at)` make double-sends impossible even if a second process appears by mistake.

Other jobs on the same loop (with their own intervals): event offsets → materialize reminders for events in the next 48 h (idempotent via `event_id + offset_minutes + occurrence`); Google Calendar sync every 5 min (`06`); pruning daily at 04:00 (soft-deleted rows > 30 days, idempotency keys > 24 h, auth attempts/audit > 90 days, notification log > 180 days).

## Catch-up (missed while down)
On startup and on every tick, overdue scheduled reminders are handled by age:
- ≤ 12 h late → send now with `late = true` and the body prefixed "Atrasado: ".
- > 12 h late → mark `missed` (no push); they show in Recordatorios and in the next morning brief (`getDaySummary` / overview include them).

## Quiet hours
If `fire_at` falls inside quiet hours and the reminder isn't `urgent`, delay delivery to the end of quiet hours (record the original time).

## Push sending
- web-push with VAPID keys from env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); public key served at runtime (`GET /api/push/vapid`).
- Send to all active subscriptions. On 404/410 → delete the subscription. On other errors → `failure_count += 1`; at 5 consecutive failures → `disabled_at = now()`; reset to 0 on success. (v1 bug: failure_count was never maintained correctly — fix and test it.)
- TTL 1 h for reminders (12 h for "Atrasado"), urgency `high` for urgent reminders.
- Payload: `{ type: "reminder", id, title, body, url, actions: [{action:"done",title:"Listo"},{action:"snooze",title:"Posponer 10 min"}], actionToken }`.

## Notification actions
- `actionToken` = HMAC-SHA256 (`SESSION_SECRET`-derived key) over `reminderId|occurrence|exp`, valid 7 days. Lets the service worker act without a live session.
- SW `notificationclick`: `done` → `POST /api/push/action {token, action:"done"}` → reminder `done` (and linked task completed if any); `snooze` → snooze by `default_snooze_minutes`; no action → open `url`.
- Endpoint is `public` access but only accepts a valid unexpired token, single use per action.

## Generic pushes
`sendPushNotification` (Sunday automations) and system notices (e.g. "Google Calendar desconectado") go through the same sender with `type: "notice"`, logged in `notification_log`.

## Tests
- Fake clock: create reminder for T, advance → exactly one delivery; restart worker → no duplicate.
- Recurring daily reminder produces next `fire_at` correctly across month ends.
- Catch-up thresholds; quiet hours shifting; failure_count/disable/reset; 410 deletes subscription; action token valid/expired/reused.
- Manual: "Probar notificación" in Ajustes works on Android Chrome (installed PWA) and Windows Chrome/Edge.

# 02 — Data model

PostgreSQL 18. Fresh migration `0000`. All PKs `uuid DEFAULT uuidv7()`. All timestamps `timestamptz`. Domain tables have `version int` (bumped by trigger), `created_at`, `updated_at` (trigger), and `deleted_at` (soft delete, needed for offline sync; purge after 30 days). Port `bump_row_version` and `touch_updated_at` from v1.

This is the target shape; refine names/types in the plan and ask before deviating materially.

## Enums
- `item_source`: `user`, `sunday`, `system`
- `task_status`: `open`, `done`, `cancelled`
- `reminder_status`: `scheduled`, `sent`, `done`, `cancelled`, `missed`
- `event_source`: `local`, `google`, `ical`
- `token_scope`: `read`, `write`, `notify`

## Settings and auth (port from v1, adapted)
- `app_user` (singleton): `pin_hash`, `timezone text default 'America/Buenos_Aires'`, `locale default 'es-AR'`, `quiet_start time`, `quiet_end time`, `default_snooze_minutes int default 10`, `settings jsonb`.
- `device`, `passkey`, `push_subscription` (+ `failure_count int`, `disabled_at`), `recovery_code`, `pin_reset_code`, `auth_attempt`, `auth_lockout` — keep v1 semantics with fixes from `07`.
- `api_token`: `id`, `name` (unique among non-revoked), `token_prefix` (first 8 chars for display), `token_hash` (sha256 of the secret), `scopes token_scope[]`, `last_used_at`, `last_used_ip`, `expires_at null`, `revoked_at null`, `created_at`. Token format: `agd_<random 32 bytes base64url>`.

## Tasks
- `task_list`: `id`, `name`, `color`, `icon`, `sort_order`, `is_inbox bool` (exactly one true; seeded "Inbox").
- `task`: `id`, `client_id text null unique`, `list_id → task_list`, `title`, `notes`, `status task_status`, `priority smallint 0..3`, `due_date date null`, `due_time time null` (requires `due_date`), `rrule text null`, `series_id uuid null` (groups occurrences of one recurring task), `completed_at`, `sort_order`, `tags text[]`, `source item_source`, + common columns.
  - Index: `(status, due_date)`, `(list_id, sort_order)`, GIN on `tags`, trigram or `tsvector` for search (choose in plan; `pg_trgm` is fine).
  - Store date + local time + the user timezone setting rather than a single instant, because a task "for Thursday at 9" is a local-time intent. Compute instants with Temporal when needed.

## Reminders
- `reminder`: `id`, `client_id null unique`, `title`, `body null`, `fire_at timestamptz`, `rrule null`, `status reminder_status`, `urgent bool default false`, `task_id null → task`, `event_id null → event`, `offset_minutes int null` (when generated from an event offset), `snoozed_from timestamptz null`, `last_fired_at null`, `source`, + common columns.
  - Partial index: `(fire_at) WHERE status = 'scheduled' AND deleted_at IS NULL`.
- `reminder_delivery`: `id`, `reminder_id`, `occurrence_at timestamptz` (the scheduled moment that fired), `sent_at`, `late bool`, `devices_ok int`, `devices_failed int`, `error text null`. `UNIQUE (reminder_id, occurrence_at)` → a moment is never delivered twice.

## Events
- `event`: `id`, `client_id null unique`, `title`, `notes`, `location`, `all_day bool`, `starts_at timestamptz null`, `ends_at timestamptz null`, `start_date date null`, `end_date date null` (all-day uses dates, end exclusive), `timezone text`, `rrule null`, `reminder_offsets int[] default '{}'`, `source item_source`, + common columns. Check constraint: timed XOR all-day fields.
- `calendar_source`: `id`, `kind event_source` (`google` | `ical`), `external_calendar_id`, `name`, `color`, `enabled bool`, `ical_url_enc bytea null`, `sync_token null`, `last_synced_at`, `last_error`, `created_at`.
- `google_credential` (singleton): `refresh_token_enc bytea`, `scopes text[]`, `account_hint text` (display only), `created_at`, `updated_at`. Encrypted with AES-256-GCM using `ENCRYPTION_KEY` (32 bytes, env).
- `external_event`: `id`, `source_id → calendar_source`, `external_id`, `etag`, `title`, `location`, `all_day`, `starts_at`, `ends_at`, `start_date`, `end_date`, `status` (confirmed/tentative/cancelled), `html_link`, `updated_remote_at`, `synced_at`. `UNIQUE (source_id, external_id)`. Read-only from the API.

## Habits, sleep, review (port and adapt from v1)
- `habit`, `habit_log` (date-based, unique per habit/date), streak calculation in domain code (Temporal, user timezone). `habit.task_tag` (phase 7, migration `0004`): completing a task with that tag checks the (yes/no) habit that day; undoing the task unchecks it unless it was checked by hand or another tagged task is still done.
- `sleep_log`: `date` (wake date), `bed_at`, `wake_at`, `quality smallint`, `notes`.
- `day_review`: `date` PK, `mood smallint 1..5 null`, `note text`, `highlights text[]`, `moved_task_ids uuid[]`, `created_at`, `updated_at`.

## Infra tables (port from v1)
- `idempotency_key` (header `Idempotency-Key`, 24 h TTL), `change_log` (for offline delta sync), `notification_log` (generic push log incl. non-reminder pushes like Sunday automations), `audit_event` (auth/token events; prune > 90 days).

## Seeds
- Inbox list. `app_user` row created by the setup flow (`SETUP_CODE`), not by migration.

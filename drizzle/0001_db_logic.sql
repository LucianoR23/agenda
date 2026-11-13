-- Hand-written database logic that drizzle-kit doesn't generate. 0000 stays 100% generated from the schema, so it
-- can be regenerated freely before the first deploy without losing anything here.
--
-- 1. Extensions (both are trusted: the owner of the `agenda` database can create them without superuser)
-- 2. Accent-insensitive search helpers + trigram indexes (searchAgenda: tasks, reminders, events)
-- 3. Triggers: version/updated_at maintained by the database
-- 4. Seed: the Inbox list

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint

-- unaccent() is STABLE (its dictionary could change), so it can't back an index. This wrapper pins the dictionary
-- and is declared IMMUTABLE, the standard way to index unaccented text. Bodies are schema-qualified: since
-- Postgres 17, index builds run with a restricted search_path.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint

-- The searchable text of a row: lowercase, unaccented, fields joined. Queries must use the same expression, e.g.
--   WHERE f_search(title, notes) LIKE '%' || f_search($1) || '%'      (substring, uses the index)
--   WHERE f_search(title, notes) % f_search($1)                       (fuzzy, pg_trgm similarity)
CREATE OR REPLACE FUNCTION f_search(VARIADIC parts text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.f_unaccent(lower(array_to_string(parts, ' ', ''))) $$;--> statement-breakpoint

CREATE INDEX task_search_trgm ON task USING gin (f_search(title, notes) gin_trgm_ops) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX reminder_search_trgm ON reminder USING gin (f_search(title, body) gin_trgm_ops) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX event_search_trgm ON event USING gin (f_search(title, notes, location) gin_trgm_ops) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX external_event_search_trgm ON external_event USING gin (f_search(title, location) gin_trgm_ops);--> statement-breakpoint

-- Optimistic concurrency + audit columns, so no write path can forget them.
-- Versioned rows: every UPDATE sets updated_at = now() and version = OLD.version + 1, whatever the app sent
-- (the app filters with WHERE version = $expected).
CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- Non-versioned rows with updated_at only.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER task_list_bump_version BEFORE UPDATE ON task_list FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER task_bump_version BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER reminder_bump_version BEFORE UPDATE ON reminder FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER event_bump_version BEFORE UPDATE ON event FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER habit_bump_version BEFORE UPDATE ON habit FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER habit_log_bump_version BEFORE UPDATE ON habit_log FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER sleep_log_bump_version BEFORE UPDATE ON sleep_log FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER day_review_bump_version BEFORE UPDATE ON day_review FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint

CREATE TRIGGER app_user_touch BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER device_touch BEFORE UPDATE ON device FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER auth_lockout_touch BEFORE UPDATE ON auth_lockout FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER push_subscription_touch BEFORE UPDATE ON push_subscription FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER calendar_source_touch BEFORE UPDATE ON calendar_source FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER google_credential_touch BEFORE UPDATE ON google_credential FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

-- The Inbox: exactly one, can't be deleted (task_list_one_inbox_uq, task_list_inbox_not_deleted).
INSERT INTO task_list (name, is_inbox, sort_order, updated_by) VALUES ('Inbox', true, 0, 'system');

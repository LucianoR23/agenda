-- Optimistic concurrency + audit columns maintained by the database, so no write path can forget them.
-- Versioned tables: every UPDATE sets updated_at = now() and version = OLD.version + 1
-- (any version value sent by the app is ignored; the app filters with WHERE version = $expected).
CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- Non-versioned tables with updated_at only.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER day_bump_version BEFORE UPDATE ON "day" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER plan_option_bump_version BEFORE UPDATE ON "plan_option" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER block_bump_version BEFORE UPDATE ON "block" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER habit_bump_version BEFORE UPDATE ON "habit" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER habit_log_bump_version BEFORE UPDATE ON "habit_log" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint
CREATE TRIGGER task_bump_version BEFORE UPDATE ON "task" FOR EACH ROW EXECUTE FUNCTION bump_row_version();--> statement-breakpoint

CREATE TRIGGER webhook_outbox_touch BEFORE UPDATE ON "webhook_outbox" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER app_user_touch BEFORE UPDATE ON "app_user" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER device_touch BEFORE UPDATE ON "device" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER auth_lockout_touch BEFORE UPDATE ON "auth_lockout" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER push_subscription_touch BEFORE UPDATE ON "push_subscription" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

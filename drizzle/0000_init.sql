CREATE TYPE "public"."auth_method" AS ENUM('setup', 'pin', 'passkey', 'recovery_code', 'reset_code', 'token');--> statement-breakpoint
CREATE TYPE "public"."lockout_scope" AS ENUM('device', 'ip', 'global');--> statement-breakpoint
CREATE TYPE "public"."token_scope" AS ENUM('read', 'write', 'notify');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('user', 'sunday', 'system');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('local', 'google', 'ical');--> statement-breakpoint
CREATE TYPE "public"."external_event_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."change_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('reminder', 'notice', 'test');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sent', 'done', 'cancelled', 'missed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."habit_kind" AS ENUM('boolean', 'numeric');--> statement-breakpoint
CREATE TYPE "public"."habit_period" AS ENUM('day', 'week');--> statement-breakpoint
CREATE TABLE "api_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" "token_scope"[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "api_token_has_scopes" CHECK (cardinality("api_token"."scopes") > 0),
	CONSTRAINT "api_token_name_length" CHECK (char_length("api_token"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webauthn_user_id" "bytea" NOT NULL,
	"timezone" text DEFAULT 'America/Buenos_Aires' NOT NULL,
	"locale" text DEFAULT 'es-AR' NOT NULL,
	"quiet_start" time DEFAULT '23:30',
	"quiet_end" time DEFAULT '07:00',
	"default_snooze_minutes" smallint DEFAULT 10 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_singleton_uq" UNIQUE("singleton"),
	CONSTRAINT "app_user_singleton" CHECK ("app_user"."singleton"),
	CONSTRAINT "app_user_snooze_range" CHECK ("app_user"."default_snooze_minutes" BETWEEN 1 AND 1440),
	CONSTRAINT "app_user_quiet_both" CHECK (("app_user"."quiet_start" IS NULL) = ("app_user"."quiet_end" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"device_id" uuid,
	"token_id" uuid,
	"ip" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"method" "auth_method" NOT NULL,
	"success" boolean NOT NULL,
	"device_key" text,
	"device_id" uuid,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_lockout" (
	"scope" "lockout_scope" NOT NULL,
	"key" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"lockout_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_lockout_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"user_agent" text,
	"session_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_unlock_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_session_hash_uq" UNIQUE("session_hash")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_device_uq" UNIQUE("device_id"),
	CONSTRAINT "passkey_credential_id_uq" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "pin_reset_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_uq" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "event_source" NOT NULL,
	"external_calendar_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"ical_url_enc" "bytea",
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_source_external_uq" UNIQUE("kind","external_calendar_id"),
	CONSTRAINT "calendar_source_kind" CHECK ("calendar_source"."kind" <> 'local'),
	CONSTRAINT "calendar_source_ical_url" CHECK (("calendar_source"."kind" = 'ical') = ("calendar_source"."ical_url_enc" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"notes" text,
	"location" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"timezone" text NOT NULL,
	"rrule" text,
	"reminder_offsets" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"source" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_timed_xor_all_day" CHECK (("event"."all_day" AND "event"."start_date" IS NOT NULL AND "event"."end_date" IS NOT NULL AND "event"."end_date" > "event"."start_date"
           AND "event"."starts_at" IS NULL AND "event"."ends_at" IS NULL)
       OR (NOT "event"."all_day" AND "event"."starts_at" IS NOT NULL AND "event"."start_date" IS NULL AND "event"."end_date" IS NULL
           AND ("event"."ends_at" IS NULL OR "event"."ends_at" >= "event"."starts_at"))),
	CONSTRAINT "event_title_length" CHECK (char_length("event"."title") BETWEEN 1 AND 500),
	CONSTRAINT "event_client_id_length" CHECK ("event"."client_id" IS NULL OR char_length("event"."client_id") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "external_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"etag" text,
	"title" text NOT NULL,
	"location" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"status" "external_event_status" DEFAULT 'confirmed' NOT NULL,
	"html_link" text,
	"updated_remote_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_event_source_external_uq" UNIQUE("source_id","external_id"),
	CONSTRAINT "external_event_timed_xor_all_day" CHECK (("external_event"."all_day" AND "external_event"."start_date" IS NOT NULL AND "external_event"."starts_at" IS NULL)
       OR (NOT "external_event"."all_day" AND "external_event"."starts_at" IS NOT NULL AND "external_event"."start_date" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "google_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"scopes" text[] NOT NULL,
	"account_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_credential_singleton_uq" UNIQUE("singleton"),
	CONSTRAINT "google_credential_singleton" CHECK ("google_credential"."singleton")
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" "change_action" NOT NULL,
	"actor" "item_source" NOT NULL,
	"token_id" uuid,
	"diff" jsonb,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_pk" PRIMARY KEY("scope","key"),
	CONSTRAINT "idempotency_key_length" CHECK (char_length("idempotency_key"."key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"reminder_id" uuid,
	"source" "item_source" NOT NULL,
	"token_id" uuid,
	"devices_ok" smallint DEFAULT 0 NOT NULL,
	"devices_failed" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"body" text,
	"fire_at" timestamp with time zone NOT NULL,
	"rrule" text,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"task_id" uuid,
	"event_id" uuid,
	"offset_minutes" integer,
	"event_occurrence_at" timestamp with time zone,
	"snoozed_from" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"source" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reminder_offset_needs_event" CHECK (("reminder"."offset_minutes" IS NULL AND "reminder"."event_occurrence_at" IS NULL) OR "reminder"."event_id" IS NOT NULL),
	CONSTRAINT "reminder_offset_range" CHECK ("reminder"."offset_minutes" IS NULL OR "reminder"."offset_minutes" BETWEEN 0 AND 40320),
	CONSTRAINT "reminder_title_length" CHECK (char_length("reminder"."title") BETWEEN 1 AND 500),
	CONSTRAINT "reminder_client_id_length" CHECK ("reminder"."client_id" IS NULL OR char_length("reminder"."client_id") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "reminder_delivery" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reminder_id" uuid NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"devices_ok" smallint DEFAULT 0 NOT NULL,
	"devices_failed" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"action" text,
	"action_at" timestamp with time zone,
	CONSTRAINT "reminder_delivery_occurrence_uq" UNIQUE("reminder_id","occurrence_at"),
	CONSTRAINT "reminder_delivery_action" CHECK ("reminder_delivery"."action" IS NULL OR "reminder_delivery"."action" IN ('done', 'snooze')),
	CONSTRAINT "reminder_delivery_action_at" CHECK (("reminder_delivery"."action" IS NULL) = ("reminder_delivery"."action_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text,
	"list_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"due_date" date,
	"due_time" time,
	"rrule" text,
	"series_id" uuid,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_priority_range" CHECK ("task"."priority" BETWEEN 0 AND 3),
	CONSTRAINT "task_time_needs_date" CHECK ("task"."due_time" IS NULL OR "task"."due_date" IS NOT NULL),
	CONSTRAINT "task_rrule_needs_date" CHECK ("task"."rrule" IS NULL OR "task"."due_date" IS NOT NULL),
	CONSTRAINT "task_completed_consistent" CHECK (("task"."status" = 'done') = ("task"."completed_at" IS NOT NULL)),
	CONSTRAINT "task_title_length" CHECK (char_length("task"."title") BETWEEN 1 AND 500),
	CONSTRAINT "task_client_id_length" CHECK ("task"."client_id" IS NULL OR char_length("task"."client_id") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "task_list" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_list_inbox_not_deleted" CHECK (NOT ("task_list"."is_inbox" AND "task_list"."deleted_at" IS NOT NULL)),
	CONSTRAINT "task_list_name_length" CHECK (char_length("task_list"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "day_review" (
	"date" date PRIMARY KEY NOT NULL,
	"mood" smallint,
	"note" text,
	"highlights" text[] DEFAULT '{}'::text[] NOT NULL,
	"moved_task_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_review_mood_range" CHECK ("day_review"."mood" IS NULL OR "day_review"."mood" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "habit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "habit_kind" NOT NULL,
	"unit" text,
	"target_count" integer NOT NULL,
	"target_period" "habit_period" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "habit_slug_format" CHECK ("habit"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "habit_target_positive" CHECK ("habit"."target_count" > 0),
	CONSTRAINT "habit_unit_only_numeric" CHECK ("habit"."unit" IS NULL OR "habit"."kind" = 'numeric')
);
--> statement-breakpoint
CREATE TABLE "habit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"habit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"done" boolean NOT NULL,
	"value" numeric(12, 2),
	"source" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sleep_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"bed_at" timestamp with time zone,
	"wake_at" timestamp with time zone,
	"quality" smallint,
	"notes" text,
	"source" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "item_source" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sleep_log_quality_range" CHECK ("sleep_log"."quality" IS NULL OR "sleep_log"."quality" BETWEEN 1 AND 5),
	CONSTRAINT "sleep_log_order" CHECK ("sleep_log"."bed_at" IS NULL OR "sleep_log"."wake_at" IS NULL OR ("sleep_log"."wake_at" > "sleep_log"."bed_at" AND "sleep_log"."wake_at" - "sleep_log"."bed_at" < interval '20 hours'))
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_attempt" ADD CONSTRAINT "auth_attempt_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_event" ADD CONSTRAINT "external_event_source_id_calendar_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_reminder_id_reminder_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_token_id_api_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_delivery" ADD CONSTRAINT "reminder_delivery_reminder_id_reminder_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_list_id_task_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."task_list"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_log" ADD CONSTRAINT "habit_log_habit_id_habit_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_token_active_name_uq" ON "api_token" USING btree ("name") WHERE "api_token"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_event_kind_idx" ON "audit_event" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "auth_attempt_at_idx" ON "auth_attempt" USING btree ("at");--> statement-breakpoint
CREATE INDEX "device_active_idx" ON "device" USING btree ("last_seen_at") WHERE "device"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_subscription_device_idx" ON "push_subscription" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_client_id_uq" ON "event" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "event_starts_idx" ON "event" USING btree ("starts_at") WHERE "event"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_start_date_idx" ON "event" USING btree ("start_date") WHERE "event"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_updated_idx" ON "event" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "external_event_starts_idx" ON "external_event" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "external_event_start_date_idx" ON "external_event" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "change_log_at_idx" ON "change_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_idx" ON "idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_log_created_idx" ON "notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_client_id_uq" ON "reminder" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "reminder_due_idx" ON "reminder" USING btree ("fire_at") WHERE "reminder"."status" = 'scheduled' AND "reminder"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reminder_task_idx" ON "reminder" USING btree ("task_id") WHERE "reminder"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_event_offset_uq" ON "reminder" USING btree ("event_id","offset_minutes","event_occurrence_at") WHERE "reminder"."event_id" IS NOT NULL AND "reminder"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reminder_updated_idx" ON "reminder" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "reminder_delivery_sent_idx" ON "reminder_delivery" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_client_id_uq" ON "task" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "task_status_due_idx" ON "task" USING btree ("status","due_date") WHERE "task"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_list_order_idx" ON "task" USING btree ("list_id","sort_order") WHERE "task"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "task_series_idx" ON "task" USING btree ("series_id") WHERE "task"."series_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_tags_gin" ON "task" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "task_updated_idx" ON "task" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_list_one_inbox_uq" ON "task_list" USING btree ("is_inbox") WHERE "task_list"."is_inbox" AND "task_list"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_list_active_name_uq" ON "task_list" USING btree (lower("name")) WHERE "task_list"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_active_slug_uq" ON "habit" USING btree ("slug") WHERE "habit"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_log_habit_date_uq" ON "habit_log" USING btree ("habit_id","date") WHERE "habit_log"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "habit_log_date_idx" ON "habit_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "habit_log_updated_idx" ON "habit_log" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_log_date_uq" ON "sleep_log" USING btree ("date") WHERE "sleep_log"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sleep_log_updated_idx" ON "sleep_log" USING btree ("updated_at");
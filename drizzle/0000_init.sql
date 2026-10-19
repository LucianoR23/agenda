CREATE TYPE "public"."actor" AS ENUM('agent', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."block_source" AS ENUM('calendar', 'agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."block_status" AS ENUM('pending', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('call', 'meeting', 'routine', 'gym', 'meal', 'reading', 'study', 'dogs', 'partner', 'sleep', 'local_work', 'padel', 'other');--> statement-breakpoint
CREATE TYPE "public"."calendar_kind" AS ENUM('work', 'personal');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('closed_won', 'follow_up', 'no_show', 'rescheduled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."day_status" AS ENUM('draft', 'chosen', 'edited', 'closed');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."habit_kind" AS ENUM('boolean', 'numeric');--> statement-breakpoint
CREATE TYPE "public"."habit_log_source" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."habit_period" AS ENUM('day', 'week');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('whatsapp_confirm', 'lead_context', 'follow_up', 'other');--> statement-breakpoint
CREATE TYPE "public"."task_origin" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."change_action" AS ENUM('create', 'update', 'delete', 'replace', 'choose', 'close', 'propose', 'accept', 'reject');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('collecting', 'pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('setup', 'pin', 'passkey', 'recovery_code', 'reset_code');--> statement-breakpoint
CREATE TYPE "public"."lockout_scope" AS ENUM('device', 'global');--> statement-breakpoint
CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"option_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"start" text NOT NULL,
	"end" text,
	"title" text NOT NULL,
	"type" "block_type" NOT NULL,
	"detail" text,
	"lead" jsonb,
	"source" "block_source" NOT NULL,
	"external_id" text,
	"external_url" text,
	"calendar" "calendar_kind",
	"status" "block_status" DEFAULT 'pending' NOT NULL,
	"status_at" timestamp with time zone,
	"outcome" "call_outcome",
	"note" text,
	"locked" boolean DEFAULT false NOT NULL,
	"user_overrides" text[] DEFAULT '{}'::text[] NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "block_start_format" CHECK ("block"."start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "block_end_format" CHECK ("block"."end" IS NULL OR "block"."end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "block_calendar_requires_external_id" CHECK ("block"."source" <> 'calendar' OR "block"."external_id" IS NOT NULL),
	CONSTRAINT "block_outcome_only_calls" CHECK ("block"."outcome" IS NULL OR "block"."type" = 'call'),
	CONSTRAINT "block_lead_only_calls" CHECK ("block"."lead" IS NULL OR "block"."type" = 'call'),
	CONSTRAINT "block_user_overrides_values" CHECK ("block"."user_overrides" <@ ARRAY['start','end','title','type','detail','lead','order']::text[])
);
--> statement-breakpoint
CREATE TABLE "day" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"status" "day_status" DEFAULT 'draft' NOT NULL,
	"chosen_option_id" uuid,
	"notes" text,
	"calls_summary" text,
	"weekly_gym_done" smallint,
	"weekly_gym_target" smallint,
	"review_energy" smallint,
	"review_mood" smallint,
	"review_text" text,
	"reviewed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "day_date_uq" UNIQUE("date"),
	CONSTRAINT "day_chosen_requires_option" CHECK ("day"."status" NOT IN ('chosen', 'edited') OR "day"."chosen_option_id" IS NOT NULL),
	CONSTRAINT "day_closed_has_closed_at" CHECK (("day"."status" = 'closed') = ("day"."closed_at" IS NOT NULL)),
	CONSTRAINT "day_weekly_gym_pair" CHECK (("day"."weekly_gym_done" IS NULL) = ("day"."weekly_gym_target" IS NULL)
        AND ("day"."weekly_gym_done" IS NULL OR ("day"."weekly_gym_done" >= 0 AND "day"."weekly_gym_target" > 0))),
	CONSTRAINT "day_review_complete" CHECK (("day"."review_energy" IS NULL) = ("day"."review_mood" IS NULL)
        AND ("day"."review_text" IS NULL OR "day"."review_energy" IS NOT NULL)),
	CONSTRAINT "day_review_energy_range" CHECK ("day"."review_energy" BETWEEN 1 AND 5),
	CONSTRAINT "day_review_mood_range" CHECK ("day"."review_mood" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "plan_option" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day_id" uuid NOT NULL,
	"label" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "plan_option_day_label_uq" UNIQUE("day_id","label"),
	CONSTRAINT "plan_option_id_day_uq" UNIQUE("id","day_id"),
	CONSTRAINT "plan_option_label_format" CHECK ("plan_option"."label" ~ '^[A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"day_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"base_day_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
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
	"block_type" "block_type",
	"active" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "habit_slug_uq" UNIQUE("slug"),
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
	"source" "habit_log_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "habit_log_habit_date_uq" UNIQUE("habit_id","date")
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"kind" "task_kind" DEFAULT 'other' NOT NULL,
	"origin" "task_origin" NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"related_block_id" uuid,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "task_done_at_consistent" CHECK ("task"."done" = ("task"."done_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor" "actor" NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"date" date,
	"action" "change_action" NOT NULL,
	"diff" jsonb,
	"forced" boolean DEFAULT false NOT NULL,
	"request_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"key" text NOT NULL,
	"actor" "actor" NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_key_pk" PRIMARY KEY("actor","key")
);
--> statement-breakpoint
CREATE TABLE "webhook_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'collecting' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_response_status" smallint,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webauthn_user_id" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_singleton_uq" UNIQUE("singleton"),
	CONSTRAINT "app_user_singleton" CHECK ("app_user"."singleton")
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
	"call_reminders" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
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
ALTER TABLE "block" ADD CONSTRAINT "block_day_id_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_option_fk" FOREIGN KEY ("option_id","day_id") REFERENCES "public"."plan_option"("id","day_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day" ADD CONSTRAINT "day_chosen_option_id_plan_option_id_fk" FOREIGN KEY ("chosen_option_id") REFERENCES "public"."plan_option"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_option" ADD CONSTRAINT "plan_option_day_id_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_day_id_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_log" ADD CONSTRAINT "habit_log_habit_id_habit_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_related_block_id_block_id_fk" FOREIGN KEY ("related_block_id") REFERENCES "public"."block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_attempt" ADD CONSTRAINT "auth_attempt_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "block_option_external_uq" ON "block" USING btree ("option_id","external_id") WHERE "block"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "block_day_external_idx" ON "block" USING btree ("day_id","external_id");--> statement-breakpoint
CREATE INDEX "block_option_order_idx" ON "block" USING btree ("option_id","order");--> statement-breakpoint
CREATE INDEX "day_status_idx" ON "day" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_one_pending_per_day_uq" ON "proposal" USING btree ("day_id") WHERE "proposal"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "proposal_day_created_idx" ON "proposal" USING btree ("day_id","created_at");--> statement-breakpoint
CREATE INDEX "habit_log_date_idx" ON "habit_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "task_date_order_idx" ON "task" USING btree ("date","order");--> statement-breakpoint
CREATE INDEX "change_log_at_idx" ON "change_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "change_log_date_idx" ON "change_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "idempotency_key_created_idx" ON "idempotency_key" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_outbox_one_collecting_per_day_uq" ON "webhook_outbox" USING btree ("date") WHERE "webhook_outbox"."status" = 'collecting';--> statement-breakpoint
CREATE INDEX "webhook_outbox_due_idx" ON "webhook_outbox" USING btree ("next_attempt_at") WHERE "webhook_outbox"."status" IN ('collecting', 'pending');--> statement-breakpoint
CREATE INDEX "auth_attempt_at_idx" ON "auth_attempt" USING btree ("at");--> statement-breakpoint
CREATE INDEX "device_active_idx" ON "device" USING btree ("last_seen_at") WHERE "device"."revoked_at" IS NULL;
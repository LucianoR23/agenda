ALTER TYPE "public"."change_action" ADD VALUE 'shift';--> statement-breakpoint
CREATE TABLE "sleep_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"bed_at" timestamp with time zone,
	"bed_source" "habit_log_source",
	"woke_at" timestamp with time zone,
	"wake_source" "habit_log_source",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "sleep_log_date_uq" UNIQUE("date"),
	CONSTRAINT "sleep_log_bed_source" CHECK (("sleep_log"."bed_at" IS NULL) = ("sleep_log"."bed_source" IS NULL)),
	CONSTRAINT "sleep_log_wake_source" CHECK (("sleep_log"."woke_at" IS NULL) = ("sleep_log"."wake_source" IS NULL)),
	CONSTRAINT "sleep_log_order" CHECK ("sleep_log"."bed_at" IS NULL OR "sleep_log"."woke_at" IS NULL
        OR ("sleep_log"."woke_at" > "sleep_log"."bed_at" AND "sleep_log"."woke_at" - "sleep_log"."bed_at" < interval '20 hours'))
);
--> statement-breakpoint
ALTER TABLE "block" DROP CONSTRAINT "block_start_format";--> statement-breakpoint
ALTER TABLE "block" DROP CONSTRAINT "block_end_format";--> statement-breakpoint
ALTER TABLE "push_subscription" ADD COLUMN "sleep_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_start_format" CHECK ("block"."start" ~ '^([01][0-9]|2[0-9]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_end_format" CHECK ("block"."end" IS NULL OR "block"."end" ~ '^([01][0-9]|2[0-9]):[0-5][0-9]$');--> statement-breakpoint
CREATE TRIGGER sleep_log_bump_version BEFORE UPDATE ON "sleep_log" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

CREATE TABLE "google_event_push" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"pushed_version" integer,
	"pushed_at" timestamp with time zone,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "google_credential" ADD COLUMN "push_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "google_credential" ADD COLUMN "agenda_calendar_id" text;--> statement-breakpoint
ALTER TABLE "google_event_push" ADD CONSTRAINT "google_event_push_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
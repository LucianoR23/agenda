ALTER TABLE "reminder" DROP CONSTRAINT "reminder_offset_needs_event";--> statement-breakpoint
ALTER TABLE "calendar_source" ADD COLUMN "reminder_minutes" integer;--> statement-breakpoint
ALTER TABLE "google_credential" ADD COLUMN "invalid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "external_event_id" uuid;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_external_event_id_external_event_id_fk" FOREIGN KEY ("external_event_id") REFERENCES "public"."external_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_external_offset_uq" ON "reminder" USING btree ("external_event_id","offset_minutes","event_occurrence_at") WHERE "reminder"."external_event_id" IS NOT NULL AND "reminder"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "calendar_source" ADD CONSTRAINT "calendar_source_reminder_minutes" CHECK ("calendar_source"."reminder_minutes" IS NULL OR "calendar_source"."reminder_minutes" BETWEEN 0 AND 1440);--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_one_event" CHECK ("reminder"."event_id" IS NULL OR "reminder"."external_event_id" IS NULL);--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_offset_needs_event" CHECK (("reminder"."offset_minutes" IS NULL AND "reminder"."event_occurrence_at" IS NULL) OR "reminder"."event_id" IS NOT NULL OR "reminder"."external_event_id" IS NOT NULL);
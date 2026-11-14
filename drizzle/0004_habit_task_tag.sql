ALTER TABLE "habit" ADD COLUMN "task_tag" text;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_task_tag_uq" ON "habit" USING btree ("task_tag") WHERE "habit"."deleted_at" IS NULL AND "habit"."task_tag" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "habit" ADD CONSTRAINT "habit_task_tag_boolean" CHECK ("habit"."task_tag" IS NULL OR "habit"."kind" = 'boolean');
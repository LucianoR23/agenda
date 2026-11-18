ALTER TABLE "change_log" ADD COLUMN "label" text;--> statement-breakpoint
-- Backfill: rows written before labels existed get the item's current title (purged items stay unlabeled).
UPDATE "change_log" c SET "label" = t."title" FROM "task" t WHERE c."entity" = 'task' AND c."entity_id" = t."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = l."name" FROM "task_list" l WHERE c."entity" = 'task_list' AND c."entity_id" = l."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = r."title" FROM "reminder" r WHERE c."entity" = 'reminder' AND c."entity_id" = r."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = e."title" FROM "event" e WHERE c."entity" = 'event' AND c."entity_id" = e."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = h."name" FROM "habit" h WHERE c."entity" = 'habit' AND c."entity_id" = h."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = h."name" || ' · ' || g."date"::text FROM "habit_log" g JOIN "habit" h ON h."id" = g."habit_id" WHERE c."entity" = 'habit_log' AND c."entity_id" = g."id"::text;--> statement-breakpoint
UPDATE "change_log" c SET "label" = 'Sueño · ' || s."date"::text FROM "sleep_log" s WHERE c."entity" = 'sleep_log' AND c."entity_id" = s."id"::text;--> statement-breakpoint
UPDATE "change_log" SET "label" = 'Cierre del día · ' || "entity_id" WHERE "entity" = 'day_review';

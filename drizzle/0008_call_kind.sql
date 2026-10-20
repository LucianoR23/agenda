CREATE TYPE "public"."call_kind" AS ENUM('closer', 'triage');--> statement-breakpoint
ALTER TYPE "public"."call_outcome" ADD VALUE 'qualified';--> statement-breakpoint
ALTER TYPE "public"."call_outcome" ADD VALUE 'not_qualified';--> statement-breakpoint
ALTER TABLE "block" DROP CONSTRAINT "block_user_overrides_values";--> statement-breakpoint
ALTER TABLE "block" ADD COLUMN "call_kind" "call_kind";--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_call_kind_only_calls" CHECK ("block"."call_kind" IS NULL OR "block"."type" = 'call');--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_user_overrides_values" CHECK ("block"."user_overrides" <@ ARRAY['start','end','title','type','callKind','detail','lead','order']::text[]);
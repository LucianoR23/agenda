CREATE TYPE "public"."adjustment_status" AS ENUM('pending', 'proposed', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "adjustment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"text" text NOT NULL,
	"status" "adjustment_status" DEFAULT 'pending' NOT NULL,
	"agent_note" text,
	"proposal_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" "actor" NOT NULL,
	CONSTRAINT "adjustment_text_length" CHECK (char_length("adjustment"."text") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_date_created_idx" ON "adjustment" USING btree ("date","created_at");--> statement-breakpoint
CREATE INDEX "adjustment_proposal_idx" ON "adjustment" USING btree ("proposal_id");--> statement-breakpoint
CREATE TRIGGER adjustment_bump_version BEFORE UPDATE ON "adjustment" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

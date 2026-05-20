CREATE TABLE "context_builder_indexed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"source" text NOT NULL,
	"item_id" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cb_indexed_source_item" UNIQUE("source","item_id")
);
--> statement-breakpoint
CREATE TABLE "context_builder_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"items_indexed" integer DEFAULT 0,
	"items_skipped" integer DEFAULT 0,
	"sonnet_tokens_in" integer DEFAULT 0,
	"sonnet_tokens_out" integer DEFAULT 0,
	"output_path" text,
	"error_log" jsonb
);
--> statement-breakpoint
CREATE TABLE "standing_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"source" text DEFAULT 'context_builder',
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "standing_context_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "context_builder_indexed_items" ADD CONSTRAINT "context_builder_indexed_items_run_id_context_builder_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."context_builder_runs"("id") ON DELETE no action ON UPDATE no action;
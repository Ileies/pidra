CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"failed_step" text,
	"step_errors" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "source_daily_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_name" text NOT NULL,
	"run_date" date NOT NULL,
	"items_received" integer DEFAULT 0,
	"items_included" integer DEFAULT 0,
	"avg_relevance" real,
	"avg_effective_relevance" real,
	"include_rate" real,
	"composite_score" real,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "source_quality" ADD COLUMN "composite_score_30d" real;--> statement-breakpoint
ALTER TABLE "source_quality" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "source_quality" ADD COLUMN "disabled_at" date;--> statement-breakpoint
ALTER TABLE "source_quality" ADD COLUMN "disabled_reason" text;
CREATE TABLE "active_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"headline" text NOT NULL,
	"domain" text NOT NULL,
	"running_summary" text,
	"first_seen" date NOT NULL,
	"last_updated" date NOT NULL,
	"status" text DEFAULT 'active',
	"update_count" integer DEFAULT 1,
	"sources" text[],
	"entity_ids" uuid[]
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"name" text,
	"relationship" text,
	"priority" text DEFAULT 'normal',
	"context_notes" text,
	"first_seen" date DEFAULT CURRENT_DATE,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contacts_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_date" date NOT NULL,
	"full_report" text,
	"short_summary" text,
	"item_count" integer,
	"items_included" integer,
	"items_filtered" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"ai_calls" integer,
	"web_searches_run" integer,
	"question_gate_fired" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "daily_reports_report_date_unique" UNIQUE("report_date")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[],
	"type" text,
	"domain" text,
	"summary" text,
	"first_seen" date,
	"last_mentioned" date,
	"mention_count" integer DEFAULT 1,
	"status" text DEFAULT 'active',
	"importance" text DEFAULT 'normal'
);
--> statement-breakpoint
CREATE TABLE "entity_appearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"report_date" date,
	"context_snippet" text,
	"relevance_score" integer
);
--> statement-breakpoint
CREATE TABLE "entity_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_id" uuid,
	"to_id" uuid,
	"relation_type" text,
	"confidence" real,
	"first_seen" date,
	"last_seen" date,
	"confirmed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_item_id" uuid,
	"run_date" date NOT NULL,
	"extracted_json" jsonb,
	"relevance_score" integer,
	"effective_relevance" real,
	"novelty" text,
	"unknown_context" boolean DEFAULT false,
	"question_for_user" text,
	"included_in_report" boolean DEFAULT false,
	"revealed_relevance" integer,
	"ai_failed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid,
	"event_type" text,
	"signal_value" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" date,
	"created_by" text DEFAULT 'system'
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"section" text NOT NULL,
	"prompt_text" text NOT NULL,
	"active" boolean DEFAULT false,
	"change_summary" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text,
	"message_id" text,
	"raw_content" text,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "raw_items_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "skill_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date,
	"skill_name" text,
	"parameters" jsonb,
	"status" text,
	"result" text,
	"triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_quality" (
	"source_name" text PRIMARY KEY NOT NULL,
	"trust_score" real DEFAULT 1,
	"include_rate_30d" real,
	"avg_revealed_relevance" real,
	"quality_trend" text DEFAULT 'stable',
	"last_quality_shift" date,
	"promotional_rate_30d" real,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "entity_appearances" ADD CONSTRAINT "entity_appearances_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_from_id_entities_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_to_id_entities_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;
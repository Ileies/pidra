CREATE TABLE IF NOT EXISTS "pipeline_run_steps" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "pipeline_runs"("id") ON DELETE CASCADE,
  "parent_id" uuid,
  "step" text NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "duration_ms" integer,
  "tokens_in" integer DEFAULT 0 NOT NULL,
  "tokens_out" integer DEFAULT 0 NOT NULL,
  "ai_calls" integer DEFAULT 0 NOT NULL,
  "search_calls" integer DEFAULT 0 NOT NULL,
  "flex_retries" integer DEFAULT 0 NOT NULL,
  "detail" jsonb
);
CREATE INDEX IF NOT EXISTS "pipeline_run_steps_run_idx" ON "pipeline_run_steps" ("run_id", "started_at");

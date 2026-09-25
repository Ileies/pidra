-- Quick actions: one-tap buttons beside a personal report item (see src/actions/).
--
-- A table of its own rather than a field of daily_reports.report_json: a report is final, while an
-- action has state the reader changes (done, dismissed). src/actions/store.ts is the only writer.
CREATE TABLE IF NOT EXISTS "report_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_date" date NOT NULL,
  "kind" text NOT NULL,
  "skill_name" text NOT NULL,
  "parameters" jsonb NOT NULL,
  "preview" jsonb NOT NULL,
  "reason" text,
  "source_extraction_ids" uuid[] NOT NULL,
  "status" text NOT NULL DEFAULT 'proposed',
  "status_detail" text,
  "skill_execution_id" uuid REFERENCES "skill_executions"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "report_actions_run_date_idx" ON "report_actions" ("run_date");

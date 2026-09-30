-- Append-only outcome log for questions (see src/db/schema.ts, src/questions/store.ts).
--
-- questions.status/status_detail only ever hold the current state, so a question asked three
-- times then merged into another loses every earlier reason the moment the next thing happens to
-- it. This table keeps every asked/reasked/rewritten/answered/dismissed/reopened/merged/
-- resolved/dropped event, with its reason, so the reconcile step's merge/resolve/drop decisions
-- can be judged against real history instead of the single row it left behind.
CREATE TABLE IF NOT EXISTS "question_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "question_id" uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "reason" text,
  "detail" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "question_events_question_id_idx" ON "question_events" ("question_id");

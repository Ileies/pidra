ALTER TABLE "notes" ADD COLUMN "source_question_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[];

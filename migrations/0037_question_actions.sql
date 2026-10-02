-- A removed sender: the row stays (locked, snapshotted on its correction) and readers skip it.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;

-- What the assistant did with an answer, and the conversation that holds the skill calls.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_status" text;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_outcome" text;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_conversation_id" uuid;

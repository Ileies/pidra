-- The question queue replaces the per-run question gate sessions (see src/questions/).
--
-- A session per run showed only the newest pending one, so a weekly review session whose job had
-- died stayed on /questions for good while each morning's sender questions timed out after 45
-- minutes unseen, and the same sender was asked again the next time. One queue with one row per
-- question, open until answered, dismissed or closed with a reason, fixes both.
--
-- Every old question is carried over. Pending and timed-out ones come back open, because none of
-- the timed-out ones was ever answered; the first reconcile run merges the repeats and closes the
-- ones the context has settled since. An answered review is left unabsorbed so its answers still
-- become insight notes, which the old job never got to do.
CREATE TABLE IF NOT EXISTS "questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "question" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "status_detail" text,
  "merged_into" uuid REFERENCES "questions"("id") ON DELETE SET NULL,
  "answer" text,
  "sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "first_asked" date NOT NULL,
  "last_asked" date NOT NULL,
  "times_asked" integer NOT NULL DEFAULT 1,
  "blocks_until" timestamp with time zone,
  "absorbed_at" timestamp with time zone,
  "answered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "questions_status_idx" ON "questions" ("status");

INSERT INTO "questions" (
  "kind", "question", "status", "status_detail", "answer", "sources",
  "first_asked", "last_asked", "answered_at", "created_at", "updated_at"
)
SELECT
  CASE WHEN q->>'item_type' = 'review' THEN 'review' ELSE 'item' END,
  q->>'question',
  CASE WHEN a.answer IS NOT NULL THEN 'answered'
       WHEN s.status = 'answered' THEN 'dismissed'
       ELSE 'open' END,
  CASE WHEN a.answer IS NULL AND s.status = 'answered' THEN 'Left blank when its session was answered.' END,
  a.answer,
  CASE WHEN q->>'item_type' = 'review' THEN '[]'::jsonb
       ELSE jsonb_build_array(jsonb_build_object(
         'extraction_id', CASE WHEN q->>'id' ~* '^[0-9a-f-]{36}$' THEN q->>'id' END,
         'from', q->>'from',
         'subject', q->>'subject',
         'source_type', q->>'item_type',
         'run_date', s.run_date::text
       )) END,
  s.run_date,
  s.run_date,
  CASE WHEN a.answer IS NOT NULL THEN s.answered_at END,
  s.created_at,
  COALESCE(s.answered_at, s.created_at)
FROM "question_gate_sessions" s
CROSS JOIN LATERAL jsonb_array_elements(s.questions) AS q
LEFT JOIN LATERAL (
  SELECT NULLIF(trim(ans->>'answer'), '') AS answer
  FROM jsonb_array_elements(COALESCE(s.answers, '[]'::jsonb)) AS ans
  WHERE ans->>'id' = q->>'id'
  LIMIT 1
) a ON true;

-- The old sessions rarely stored a subject; the mail itself still has it.
UPDATE "questions" q
SET "sources" = jsonb_set(q."sources", '{0,subject}', to_jsonb(substring(r."raw_content" from '^Subject: ([^\n]*)')))
FROM "extractions" e
JOIN "raw_items" r ON r."id" = e."raw_item_id"
WHERE q."kind" = 'item'
  AND q."sources"->0->>'subject' IS NULL
  AND e."id"::text = q."sources"->0->>'extraction_id'
  AND r."raw_content" LIKE 'Subject: %';

DROP TABLE "question_gate_sessions";

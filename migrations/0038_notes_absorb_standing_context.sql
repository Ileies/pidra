-- Standing rules become notes. A seeded row keeps its Keep identity here, so a re-run finds it
-- instead of duplicating it, and the weekly trash purge leaves it alone.
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "source_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS notes_source_key_idx ON notes (source_key) WHERE source_key IS NOT NULL;

-- Copy every standing rule across as a `personal` note, once. A rule an active retract correction
-- targets arrives already in the trash, so the retraction is carried by the row and not by a
-- correction statement the model has to honour next to the rule's own text.
INSERT INTO notes (content, scope, created_at, created_by, deleted_at, source_key)
SELECT
  s.value,
  'personal',
  coalesce(s.updated_at, now()),
  CASE WHEN s.source = 'context_builder' THEN 'harvest' ELSE 'user' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM context_corrections c
    WHERE c.target_kind = 'standing_context' AND c.target_key = s.key
      AND c.operation = 'retract' AND c.status = 'active'
  ) THEN now() END,
  CASE WHEN s.key LIKE 'keep\_rule\_%' THEN s.key END
FROM standing_context s;

-- The retractions are now carried by the trashed rows above.
UPDATE context_corrections
SET status = 'reverted', reverted_at = now()
WHERE target_kind = 'standing_context' AND status = 'active';

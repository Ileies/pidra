-- Keyword search across the archive (dashboard/src/lib/server/search.ts).
-- Reference copy of DDL that is NOT in src/db/schema/: declared there, each generated tsvector
-- would come back in every `select()` row of its table. Applied by hand to the production database
-- (2026-09-12); the db test harness (scripts/lib/test-postgres.ts) applies this file after the
-- exported schema, and a fresh database needs it too, or /api/search fails with "column does not exist".
-- Idempotent: safe to run again.
--
-- Generated columns, not triggers and not application code: a stored tsvector derived by the
-- database cannot drift from the text it indexes.
--
-- `simple`, not `english`: the archive mixes German and English, and an English stemmer applied to
-- German text produces confidently wrong matches. `simple` gives exact word matching.

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(full_report, ''))) STORED;

ALTER TABLE extractions
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce(extracted_json ->> 'headline', '') || ' ' ||
      coalesce(extracted_json ->> 'key_claim', '') || ' ' ||
      coalesce(extracted_json ->> 'action_required', '')
    )
  ) STORED;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

-- Aliases are deliberately not in here: `array_to_string` is STABLE rather than IMMUTABLE, so
-- Postgres refuses it in a generated column. An alias hit almost always also matches on the name or
-- the summary, and /entities' own filter searches aliases exactly.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(summary, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS daily_reports_search_idx ON daily_reports USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS extractions_search_idx ON extractions USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS entities_search_idx ON entities USING GIN (search_tsv);

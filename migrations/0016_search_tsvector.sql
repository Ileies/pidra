-- DASHBOARD_PLAN D8 / decision 5: keyword search across the archive.
--
-- Generated columns, not triggers and not application code: a stored tsvector that is derived by
-- the database cannot drift from the text it indexes, which is the failure mode this would
-- otherwise develop the first time a writer forgets to update it.
--
-- `simple`, not `english`: the archive is a mix of German and English, and an English stemmer
-- applied to German text produces confidently wrong matches. `simple` gives exact word matching,
-- which is predictable and is what a keyword search should be. Semantic search is parked
-- deliberately - see DASHBOARD_PLAN §12 - and is not what this is trying to approximate.
--
-- drizzle-kit migrate hangs in this environment, so this was applied manually via a temporary
-- Bun script using `new SQL(DATABASE_URL)`. This file is the reference copy.

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
-- Postgres refuses it in a generated column. Including them would mean a trigger, and a trigger
-- is exactly the drift this design avoids. An alias hit almost always also matches on the name
-- or the summary, and searching aliases exactly is what /entities' own filter is for.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(summary, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS daily_reports_search_idx ON daily_reports USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS extractions_search_idx ON extractions USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS entities_search_idx ON entities USING GIN (search_tsv);

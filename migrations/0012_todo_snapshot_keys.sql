-- Re-key the Google Tasks rows in raw_items from a per-day log to a per-task snapshot.
-- Applied manually on 2026-09-11 against pronix (drizzle-kit migrate hangs in this environment).
--
-- No DDL. The old ingest key was `todo:<run_date>:<task id>`, so every task that stayed open
-- cost a fresh row every morning: 171 a day, roughly 62k a year, and nothing ever reads a past
-- day's snapshot. `src/ingest/google.ts` now writes `todo:<task id>` and refreshes `run_date`,
-- `raw_content` and `received_at` on conflict, so an open task keeps one row and a completed or
-- deleted one simply stops being refreshed.
--
-- This strips the date out of the keys already written, so the next run updates those rows
-- instead of inserting a second copy of every task. Safe because the dated keys were unique per
-- day and only one day had been ingested: 171 rows, 171 distinct task ids, no extraction
-- referencing any of them. On a database where several days were ingested, the duplicates have
-- to go first (keep the newest row per task id), otherwise this hits the unique index on
-- message_id.

UPDATE raw_items
  SET message_id = regexp_replace(message_id, '^todo:\d{4}-\d{2}-\d{2}:', 'todo:')
  WHERE source_type = 'todo'
    AND message_id ~ '^todo:\d{4}-\d{2}-\d{2}:';

-- Verification: no dated keys left, and one row per task.
--   SELECT count(*) FROM raw_items WHERE source_type = 'todo' AND message_id ~ '^todo:\d{4}-';
--   SELECT count(*), count(DISTINCT message_id) FROM raw_items WHERE source_type = 'todo';

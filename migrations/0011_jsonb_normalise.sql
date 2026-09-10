-- Normalise double-encoded jsonb. Applied manually on 2026-09-10 against pronix
-- (drizzle-kit migrate hangs in this environment), by a Bun script that parsed each value in
-- JS and wrote it back as an object. Kept here so the same repair is reproducible on any
-- database restored from a dump taken before that date.
--
-- No DDL: every column below was already `jsonb`. What was wrong was the *contents*. Drizzle's
-- built-in `jsonb` type calls JSON.stringify in its toDriver (correct for node-postgres), and
-- the Bun SQL driver then serialises that string a second time, so every value written through
-- the ORM landed as a JSON string scalar: jsonb_typeof = 'string', and `->`, `@>`,
-- `jsonb_array_length` and GIN indexing all fail or misbehave on it.
--
-- The writer is fixed in src/db/jsonb.ts, which replaces the pg-core type with one that hands
-- the value to the driver untouched. This file repairs the 1,988 values written before it.
--
-- CAVEAT: one row in context_builder_indexed_items.data carried a lone UTF-16 surrogate
-- (`\ud83c` with no low half, from content truncated mid-emoji). Postgres accepts that inside a
-- string scalar but rejects it as an escape in real jsonb, so the statement below aborts with
-- 22P02 "Unicode low surrogate must follow a high surrogate". Such a row has to be repaired in
-- JS (replace the unpaired surrogate with U+FFFD) rather than by SQL. The original run did
-- exactly that for the single affected row.

UPDATE extractions
  SET extracted_json = (extracted_json #>> '{}')::jsonb
  WHERE jsonb_typeof(extracted_json) = 'string';

UPDATE context_builder_indexed_items
  SET data = (data #>> '{}')::jsonb
  WHERE jsonb_typeof(data) = 'string';

UPDATE context_corrections
  SET previous_state = (previous_state #>> '{}')::jsonb
  WHERE jsonb_typeof(previous_state) = 'string';

UPDATE question_gate_sessions
  SET questions = (questions #>> '{}')::jsonb
  WHERE jsonb_typeof(questions) = 'string';

UPDATE question_gate_sessions
  SET answers = (answers #>> '{}')::jsonb
  WHERE jsonb_typeof(answers) = 'string';

UPDATE skill_executions
  SET parameters = (parameters #>> '{}')::jsonb
  WHERE jsonb_typeof(parameters) = 'string';

UPDATE pipeline_runs
  SET step_errors = (step_errors #>> '{}')::jsonb
  WHERE jsonb_typeof(step_errors) = 'string';

UPDATE context_builder_runs
  SET error_log = (error_log #>> '{}')::jsonb
  WHERE jsonb_typeof(error_log) = 'string';

UPDATE chat_messages
  SET tool_calls = (tool_calls #>> '{}')::jsonb
  WHERE jsonb_typeof(tool_calls) = 'string';

UPDATE chat_messages
  SET page_context = (page_context #>> '{}')::jsonb
  WHERE jsonb_typeof(page_context) = 'string';

-- Verification: every row should now report object or array, never string.
--   SELECT jsonb_typeof(extracted_json), count(*) FROM extractions GROUP BY 1;

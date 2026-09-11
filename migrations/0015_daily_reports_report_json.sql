-- DASHBOARD_PLAN C1 / decision 4: the structured form of the report, alongside the markdown.
--
-- Nullable, and `full_report` is never dropped: it is what the model actually produced, and the
-- archive must remain readable if the parser in src/pipeline/report-json.ts is ever wrong. A
-- parse that cannot find both section headings writes NULL and the dashboard falls back to
-- rendering the markdown as before.
--
-- drizzle-kit migrate hangs in this environment, so this was applied manually via a temporary
-- Bun script using `new SQL(DATABASE_URL)`. This file is the reference copy.

ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS report_json jsonb;

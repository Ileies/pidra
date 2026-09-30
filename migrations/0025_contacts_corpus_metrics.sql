ALTER TABLE "contacts" ADD COLUMN "categories" text[] DEFAULT '{}'::text[];
ALTER TABLE "contacts" ADD COLUMN "action_count" integer DEFAULT 0;

-- Existing contacts already passed the insert-only seed. Populate their corpus metrics once
-- from the indexed email extractions, without changing any live email_count values.
WITH corpus AS (
  SELECT lower(data->>'from') AS identifier,
         array_agg(DISTINCT data->>'category' ORDER BY data->>'category')
           FILTER (WHERE data->>'category' IS NOT NULL) AS categories,
         count(*) FILTER (WHERE nullif(data->>'actionRequired', '') IS NOT NULL)::integer AS action_count
  FROM context_builder_indexed_items
  WHERE source = 'email' AND jsonb_typeof(data) = 'object'
  GROUP BY lower(data->>'from')
)
UPDATE contacts
SET categories = coalesce(corpus.categories, '{}'::text[]),
    action_count = corpus.action_count
FROM corpus
WHERE contacts.identifier = corpus.identifier;

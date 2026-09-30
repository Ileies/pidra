-- Stage 1 of docs/todo/entities.md: replace per-claim mention counting with one row per
-- (entity, source item), and drop the relation graph (no confirmed edges, no evidence, never
-- read by synthesis - see the plan's audit).

CREATE TABLE "entity_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE CASCADE,
  "source_kind" text NOT NULL,
  "source_ref" text NOT NULL,
  "mention_date" date,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "entity_mentions_entity_source" UNIQUE ("entity_id", "source_kind", "source_ref")
);

ALTER TABLE "entities" ADD COLUMN "last_watch_search" date;

ALTER TABLE "entity_appearances" ADD CONSTRAINT "entity_appearances_entity_date" UNIQUE ("entity_id", "report_date");

DROP TABLE "entity_relations";

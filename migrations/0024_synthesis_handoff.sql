-- Section 1's 30-item capacity is a second decision after the relevance gate.
-- Nullable for older runs and for sources that do not use this capacity.
ALTER TABLE "extractions" ADD COLUMN "synthesis_handoff" text;
ALTER TABLE "extractions" ADD COLUMN "synthesis_order" integer;

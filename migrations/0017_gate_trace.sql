-- The trace behind "why is this mail not in the report" (see src/pipeline/gate.ts).
--
-- extractions.gate_*: the Phase 3 verdict, which was previously an anonymous .filter() that left
-- nothing behind. Nullable, because every row written before this migration has no verdict and
-- "not recorded" is a different statement from "rejected".
ALTER TABLE "extractions" ADD COLUMN "gate_passed" boolean;
ALTER TABLE "extractions" ADD COLUMN "gate_reason" text;
ALTER TABLE "extractions" ADD COLUMN "gate_detail" jsonb;

-- ingest_drops: mail thrown away by the IMAP ingest before it became a raw_items row.
CREATE TABLE IF NOT EXISTS "ingest_drops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_date" date NOT NULL,
  "account_id" text,
  "source_type" text,
  "source_name" text,
  "message_id" text,
  "subject" text,
  "sender" text,
  "received_at" timestamp with time zone,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ingest_drops_run_date_idx" ON "ingest_drops" ("run_date");
CREATE INDEX IF NOT EXISTS "extractions_run_date_idx" ON "extractions" ("run_date");

-- Notification rows are derived from reports, questions, and pipeline runs. This table stores
-- only the user's acknowledgement, so a source row stays the source of truth.
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "notification_key" text PRIMARY KEY,
  "read_at" timestamp with time zone DEFAULT now()
);

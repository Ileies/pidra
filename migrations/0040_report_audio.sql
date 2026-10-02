-- Spoken form of a report, one row per chapter (a report group: an urgency level, a news group, a
-- briefing domain). `chapter_key` is a hash of the exact text that was spoken, so a changed report
-- or a changed spoken form misses the cache and is paid for again, while a replay costs nothing.
-- `variant` is "<model>:<voice>". Written only by src/audio/store.ts.
CREATE TABLE IF NOT EXISTS "report_audio" (
  "report_date" date NOT NULL,
  "chapter_key" text NOT NULL,
  "variant" text NOT NULL,
  "audio" bytea NOT NULL,
  "duration_ms" integer NOT NULL,
  "chars" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "report_audio_pkey" PRIMARY KEY ("report_date", "chapter_key", "variant")
);

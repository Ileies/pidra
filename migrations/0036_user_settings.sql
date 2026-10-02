-- One row of owner preferences (id = 1). Languages are two-letter codes only: the CHECKs make a
-- free-text value impossible even for a write that skips the dashboard's allowlist, and the
-- pipeline resolves the code through src/config/languages.ts before any prompt sees it.
CREATE TABLE IF NOT EXISTS "user_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "ui_language" text DEFAULT 'en' NOT NULL,
  "content_language" text DEFAULT 'en' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "user_settings_singleton" CHECK ("id" = 1),
  CONSTRAINT "user_settings_ui_language_code" CHECK ("ui_language" ~ '^[a-z]{2}$'),
  CONSTRAINT "user_settings_content_language_code" CHECK ("content_language" ~ '^[a-z]{2}$')
);

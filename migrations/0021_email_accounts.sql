-- IMAP/SMTP account configuration, moved off the gitignored email-accounts.json so it can be
-- managed from the dashboard (/settings/email-accounts) instead of hand-editing a file on each
-- machine. "password" is AES-256-GCM ciphertext (src/config/crypto.ts), keyed by
-- CONFIG_ENCRYPTION_KEY - a per-machine secret in .env, never in this table.
CREATE TABLE IF NOT EXISTS "email_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL,
  "host" text NOT NULL,
  "account_user" text NOT NULL,
  "password" text NOT NULL,
  "folder" text NOT NULL DEFAULT 'INBOX',
  "is_news_account" boolean NOT NULL DEFAULT false,
  "custom_instructions" text,
  "aliases" jsonb,
  "ignore" jsonb,
  "smtp_host" text,
  "smtp_port" integer,
  "smtp_secure" boolean,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

-- Application-level login, replacing the wg0 VPN as the dashboard's security boundary now that
-- pidra.de is public (hosts/pronix/nginx.nix). Every login is a WebAuthn passkey assertion
-- followed by a PIN, in that order - the PIN is only ever checked after a passkey already
-- succeeded. dashboard/src/lib/server/auth.ts is the single writer for all three tables.
CREATE TABLE IF NOT EXISTS "auth_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "credential_id" text NOT NULL UNIQUE,
  "public_key" text NOT NULL,
  "counter" integer NOT NULL DEFAULT 0,
  "device_label" text,
  "transports" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "last_used_at" timestamp with time zone
);

-- A single mutable row, replaced in place rather than versioned - there is exactly one PIN.
CREATE TABLE IF NOT EXISTS "auth_pin" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pin_hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now()
);

-- "id" is the SHA-256 hash of the raw session token; the cookie carries the raw token, never this.
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone,
  "user_agent" text
);

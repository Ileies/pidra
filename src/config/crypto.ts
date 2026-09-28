import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for the one secret this project stores in Postgres rather than
 * a gitignored file or `.env`: IMAP/SMTP account passwords (`email_accounts.password`). The key
 * is per-machine, in `.env` as `CONFIG_ENCRYPTION_KEY`, never in the database itself - the same
 * split as `AUTH_SETUP_TOKEN` and the VAPID keys. Generate with `openssl rand -hex 32`.
 *
 * Mirrored in `dashboard/src/lib/server/crypto.ts`: the dashboard has its own Postgres connection
 * (`dashboard/src/lib/db.ts`) and does not import from this package, the same split as every other
 * dashboard-side writer (`auth.ts`, `rules.ts`).
 */

function key(): Buffer {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error("CONFIG_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CONFIG_ENCRYPTION_KEY } from "$app/env/private";

/**
 * AES-256-GCM at-rest encryption for `email_accounts.password`, mirroring `src/config/crypto.ts`
 * on the pipeline side. The dashboard has its own Postgres connection (`#lib/server/postgres.js`) and does not
 * import from that package, the same split as every other dashboard-side writer (`auth.ts`,
 * `rules.ts`). The key is `CONFIG_ENCRYPTION_KEY`, a per-machine secret in `.env` - generate with
 * `openssl rand -hex 32`, set independently on the workstation and pronix, never carried by a
 * deploy.
 */

function key(): Buffer {
  const raw = CONFIG_ENCRYPTION_KEY;
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

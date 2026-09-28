/**
 * `email_accounts` writes and reads for `/settings/email-accounts`, the single writer so the
 * page's form actions cannot drift from what the pipeline (`src/config/email-accounts.ts`) and
 * the Context Builder later read.
 *
 * Passwords are write-only here by design (asked for by the owner, 2026-09-28): a saved password
 * is never read back or rendered, only replaced. `listEmailAccounts` and `getEmailAccount`
 * therefore never select the `password` column at all - there is no decrypt function in
 * `./crypto.ts` for that reason, not just an unused one.
 */

import { sql } from "#lib/db.js";
import { encryptSecret } from "./crypto";

export class EmailAccountError extends Error {}

export interface EmailAccountRow {
  id: string;
  label: string;
  host: string;
  user: string;
  folder: string;
  isNewsAccount: boolean;
  customInstructions: string | null;
  aliases: string[] | null;
  ignore: string[] | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EmailAccountInput {
  label: string;
  host: string;
  user: string;
  /** Blank on update keeps the existing password; required on create. */
  password: string;
  folder: string;
  isNewsAccount: boolean;
  customInstructions: string | null;
  aliases: string[];
  ignore: string[];
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
}

function normalise(input: Partial<EmailAccountInput>): Omit<EmailAccountInput, "password"> {
  const label = (input.label ?? "").trim();
  const host = (input.host ?? "").trim();
  const user = (input.user ?? "").trim();
  if (!label) throw new EmailAccountError("A label is required.");
  if (!host) throw new EmailAccountError("A host is required.");
  if (!user) throw new EmailAccountError("A user is required.");

  const smtpPort = input.smtpPort ?? null;
  if (smtpPort !== null && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) {
    throw new EmailAccountError("SMTP port must be an integer between 1 and 65535.");
  }

  return {
    label,
    host,
    user,
    folder: (input.folder ?? "").trim() || "INBOX",
    isNewsAccount: !!input.isNewsAccount,
    customInstructions: (input.customInstructions ?? "").trim() || null,
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    ignore: (input.ignore ?? []).map((a) => a.trim()).filter(Boolean),
    smtpHost: (input.smtpHost ?? "").trim() || null,
    smtpPort,
    smtpSecure: !!input.smtpSecure,
  };
}

export async function listEmailAccounts(): Promise<EmailAccountRow[]> {
  return sql()<EmailAccountRow[]>`
    SELECT id, label, host, account_user AS "user", folder,
           is_news_account AS "isNewsAccount", custom_instructions AS "customInstructions",
           aliases, ignore, smtp_host AS "smtpHost", smtp_port AS "smtpPort", smtp_secure AS "smtpSecure",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM email_accounts ORDER BY created_at ASC`;
}

export async function createEmailAccount(input: EmailAccountInput): Promise<{ id: string }> {
  const n = normalise(input);
  const password = (input.password ?? "").trim();
  if (!password) throw new EmailAccountError("A password is required.");

  const [row] = await sql()`
    INSERT INTO email_accounts
      (label, host, account_user, password, folder, is_news_account, custom_instructions,
       aliases, ignore, smtp_host, smtp_port, smtp_secure)
    VALUES
      (${n.label}, ${n.host}, ${n.user}, ${encryptSecret(password)}, ${n.folder}, ${n.isNewsAccount},
       ${n.customInstructions}, ${sql().json(n.aliases)}, ${sql().json(n.ignore)},
       ${n.smtpHost}, ${n.smtpPort}, ${n.smtpSecure})
    RETURNING id`;
  return { id: row.id as string };
}

export async function updateEmailAccount(id: string, input: EmailAccountInput): Promise<void> {
  const n = normalise(input);
  const password = (input.password ?? "").trim();

  const [row] = await sql()`
    UPDATE email_accounts SET
      label = ${n.label}, host = ${n.host}, account_user = ${n.user}, folder = ${n.folder},
      is_news_account = ${n.isNewsAccount}, custom_instructions = ${n.customInstructions},
      aliases = ${sql().json(n.aliases)}, ignore = ${sql().json(n.ignore)},
      smtp_host = ${n.smtpHost}, smtp_port = ${n.smtpPort}, smtp_secure = ${n.smtpSecure},
      updated_at = now()
      ${password ? sql()`, password = ${encryptSecret(password)}` : sql()``}
    WHERE id = ${id}
    RETURNING id`;
  if (!row) throw new EmailAccountError(`Email account ${id} not found`);
}

export async function deleteEmailAccount(id: string): Promise<void> {
  await sql()`DELETE FROM email_accounts WHERE id = ${id}`;
}

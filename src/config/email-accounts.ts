import { asc } from "drizzle-orm";
import { db, emailAccounts } from "../db";
import { decryptSecret } from "./crypto";

export interface EmailAccount {
  label: string;
  host: string;
  user: string;
  password: string;
  folder: string;
  isNewsAccount: boolean;
  customInstructions: string | null;
  aliases?: string[];
  ignore?: string[];
  // Optional SMTP overrides - derived from host when omitted
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
}

export function smtpHost(account: EmailAccount): string {
  if (account.smtp_host) return account.smtp_host;
  return account.host.replace(/^imap\./, "smtp.");
}

let _accounts: EmailAccount[] | null = null;

/** Reads `email_accounts`, decrypting each password. Memoized for the life of the process, same
 *  as the old JSON loader - the pipeline and the Context Builder are both one-shot runs. */
export async function loadEmailAccounts(): Promise<EmailAccount[]> {
  if (_accounts) return _accounts;

  const rows = await db.select().from(emailAccounts).orderBy(asc(emailAccounts.createdAt));

  _accounts = rows.map((row) => ({
    label: row.label,
    host: row.host,
    user: row.user,
    password: decryptSecret(row.password),
    folder: row.folder,
    isNewsAccount: row.isNewsAccount,
    customInstructions: row.customInstructions,
    aliases: row.aliases ?? undefined,
    ignore: row.ignore ?? undefined,
    smtp_host: row.smtpHost ?? undefined,
    smtp_port: row.smtpPort ?? undefined,
    smtp_secure: row.smtpSecure ?? undefined,
  }));
  return _accounts;
}

import { readFileSync } from "fs";
import { join } from "path";

export interface EmailAccount {
  label: string;
  host: string;
  user: string;
  password: string;
  folder: string;
  isNewsAccount: boolean;
  customInstructions: string | null;
  // Optional SMTP overrides — derived from host when omitted
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
}

export function smtpHost(account: EmailAccount): string {
  if (account.smtp_host) return account.smtp_host;
  return account.host.replace(/^imap\./, "smtp.");
}

let _accounts: EmailAccount[] | null = null;

export function loadEmailAccounts(): EmailAccount[] {
  if (_accounts) return _accounts;

  const configPath = join(process.cwd(), "email-accounts.json");
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as { accounts: EmailAccount[] };

  _accounts = raw.accounts.filter((a) => a.host && a.user && a.password);
  return _accounts;
}

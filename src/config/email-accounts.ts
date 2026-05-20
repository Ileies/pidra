import { readFileSync } from "fs";
import { join } from "path";

type RawEmailAccount = Omit<EmailAccount, "folder" | "isNewsAccount" | "customInstructions"> & {
  folder?: string;
  isNewsAccount?: boolean;
  customInstructions?: string | null;
};

export interface EmailAccount {
  label: string;
  host: string;
  user: string;
  password: string;
  folder: string;
  isNewsAccount: boolean;
  customInstructions: string | null;
  aliases?: string[];
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
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as { accounts: RawEmailAccount[] };

  _accounts = raw.accounts
    .filter((a) => a.host && a.user && a.password)
    .map((a) => ({
      ...a,
      folder: a.folder ?? "INBOX",
      isNewsAccount: a.isNewsAccount ?? false,
      customInstructions: a.customInstructions ?? null,
    }));
  return _accounts;
}

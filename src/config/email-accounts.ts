import { readFileSync } from "fs";
import { join } from "path";

export interface EmailAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  folder: string;
  // If true, use newsletter domain detection (for the dedicated news inbox)
  isNewsAccount: boolean;
  // If true, AI adds email_category field to distinguish personal vs. noise
  classifyNewsVsPersonal: boolean;
  // Injected into the AI classification prompt for this account's emails
  customInstructions: string | null;
  // Own addresses for this account — skip self-sent emails
  selfEmails: string[];
}

let _accounts: EmailAccount[] | null = null;

export function loadEmailAccounts(): EmailAccount[] {
  if (_accounts) return _accounts;

  const configPath = join(process.cwd(), "email-accounts.json");
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as { accounts: EmailAccount[] };

  _accounts = raw.accounts.filter((a) => a.host && a.user && a.password);
  return _accounts;
}

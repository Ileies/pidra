import type { EmailAccount } from "../config/email-accounts";

export function findSenderAccount(accounts: EmailAccount[], key: string): EmailAccount | undefined {
  return accounts.find(
    (account) => account.user.toLowerCase() === key ||
      (account.aliases ?? []).some((alias) => alias.toLowerCase() === key),
  );
}

export function assertAllowedRecipients(addresses: string[], allowedRecipients: string[]): void {
  for (const address of addresses) {
    if (!allowedRecipients.includes(address)) {
      throw new Error(`Recipient not allowed: ${address}. Allowed: ${allowedRecipients.join(", ")}`);
    }
  }
}

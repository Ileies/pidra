import Imap from "imap";
import type { EmailAccount } from "../config/email-accounts";

/** Shared by the daily pipeline's incremental ingest and the Context Builder's bulk harvest - both connect to the same accounts, just over different lookback windows. */
export function openImap(account: EmailAccount): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: account.host,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      connTimeout: 15000,
    });

    imap.once("ready", () => resolve(imap));
    imap.once("error", reject);
    imap.connect();
  });
}

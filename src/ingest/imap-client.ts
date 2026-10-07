import Imap from "imap";
import type { EmailAccount } from "../config/email-accounts";

/** node-imap's own connTimeout and authTimeout cover a silent host but not a refused connection under Bun, so openImap also enforces this. */
const OPEN_DEADLINE_MS = 30000;

/**
 * Shared by the daily pipeline's incremental ingest and the Context Builder's bulk harvest - both connect to the same accounts, just over different lookback windows.
 * Always settles: under Bun an ECONNREFUSED is printed but never reaches the "error" listener, so a deadline rejects instead of leaving Phase 1 waiting forever.
 */
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

    const deadline = setTimeout(() => {
      imap.destroy();
      reject(new Error(`IMAP connection to ${account.host} did not become ready within ${OPEN_DEADLINE_MS / 1000}s`));
    }, OPEN_DEADLINE_MS);

    imap.once("ready", () => {
      clearTimeout(deadline);
      resolve(imap);
    });
    imap.once("error", (err: Error) => {
      clearTimeout(deadline);
      reject(err);
    });
    imap.connect();
  });
}

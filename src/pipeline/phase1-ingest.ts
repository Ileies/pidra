import { ingestImapAccount } from "../ingest/imap";
import { loadEmailAccounts } from "../config/email-accounts";

export interface IngestResult {
  emailCount: number;
  rssCount: number;
  total: number;
}

export async function runPhase1(runDate: string): Promise<IngestResult> {
  console.log(`[Phase 1] Starting ingestion for ${runDate}`);

  const accounts = loadEmailAccounts();
  if (accounts.length === 0) {
    console.warn("[Phase 1] No email accounts configured in email-accounts.json");
  }

  const counts = await Promise.allSettled(
    accounts.map((account) => ingestImapAccount(account, runDate))
  );

  let emailCount = 0;
  for (let i = 0; i < counts.length; i++) {
    const result = counts[i];
    if (result.status === "fulfilled") {
      emailCount += result.value;
    } else {
      console.error(`[Phase 1] Account "${accounts[i].id}" failed:`, result.reason);
    }
  }

  const result: IngestResult = {
    emailCount,
    rssCount: 0,
    total: emailCount,
  };

  console.log(`[Phase 1] Done — ${result.total} items ingested across ${accounts.length} accounts`);
  return result;
}

import { ingestImap } from "../ingest/imap";

export interface IngestResult {
  emailCount: number;
  rssCount: number;
  total: number;
}

export async function runPhase1(runDate: string): Promise<IngestResult> {
  console.log(`[Phase 1] Starting ingestion for ${runDate}`);

  // Run IMAP ingestion (RSS to be added alongside it once feeds are audited)
  const emailCount = await ingestImap(runDate);

  const result: IngestResult = {
    emailCount,
    rssCount: 0,
    total: emailCount,
  };

  console.log(`[Phase 1] Done — ${result.total} items ingested`);
  return result;
}

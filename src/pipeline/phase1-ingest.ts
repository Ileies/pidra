import { ingestImapAccount } from "../ingest/imap";
import { ingestRssFeeds } from "../ingest/rss";
import { ingestGoogleCalendar, ingestGoogleTasks } from "../ingest/google";
import { loadEmailAccounts } from "../config/email-accounts";

export interface IngestResult {
  emailCount: number;
  rssCount: number;
  calendarCount: number;
  todoCount: number;
  total: number;
}

export async function runPhase1(runDate: string): Promise<IngestResult> {
  console.log(`[Phase 1] Starting ingestion for ${runDate}`);

  const accounts = loadEmailAccounts();
  if (accounts.length === 0) {
    console.warn("[Phase 1] No email accounts configured in email-accounts.json");
  }

  const [imapResults, rssCount, calendarCount, todoCount] = await Promise.all([
    Promise.allSettled(accounts.map((account) => ingestImapAccount(account, runDate))),
    ingestRssFeeds(runDate),
    ingestGoogleCalendar(runDate),
    ingestGoogleTasks(runDate),
  ]);

  let emailCount = 0;
  for (let i = 0; i < imapResults.length; i++) {
    const r = imapResults[i];
    if (r.status === "fulfilled") {
      emailCount += r.value;
    } else {
      console.error(`[Phase 1] Account "${accounts[i].user}" failed:`, r.reason);
    }
  }

  const result: IngestResult = {
    emailCount,
    rssCount,
    calendarCount,
    todoCount,
    total: emailCount + rssCount + calendarCount + todoCount,
  };

  console.log(
    `[Phase 1] Done — ${result.total} items (${emailCount} email, ${rssCount} RSS, ${calendarCount} calendar, ${todoCount} todos)`
  );
  return result;
}

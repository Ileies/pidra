import { ingestImapAccount } from "../ingest/imap";
import { ingestRssFeeds } from "../ingest/rss";
import { ingestGoogleCalendar, ingestGoogleTasks } from "../ingest/google";
import { loadEmailAccounts } from "../config/email-accounts";

export interface SourceFailure {
  source: string;
  error: string;
}

export interface IngestResult {
  emailCount: number;
  rssCount: number;
  calendarCount: number;
  todoCount: number;
  total: number;
  /** Sources that threw. The run continues on whatever else worked; `run.ts` records these. */
  failures: SourceFailure[];
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/**
 * Ingestion, source by source, where no single source can take down the others.
 *
 * The IMAP accounts were already settled individually, but RSS, Calendar and Tasks sat as bare
 * members of the same `Promise.all`, so any one of them rejecting rejected the whole thing and
 * failed the step - and `withRetry` then failed the run. That is what happened on 2026-09-12: the
 * Google refresh token had been revoked, `invalid_grant` came back in milliseconds, and a dead
 * calendar took the newsletters and the mail down with it. Nine seconds, no briefing, even though
 * every mailbox had connected and 24 feeds were mid-poll.
 *
 * A morning briefing is worth more partial than absent, so a failing source is now logged, counted
 * as zero and reported upward. The step throws only when *every* source failed, which is a real
 * outage (no network, no database) rather than one expired credential.
 */
export async function runPhase1(runDate: string): Promise<IngestResult> {
  console.log(`[Phase 1] Starting ingestion for ${runDate}`);

  const accounts = loadEmailAccounts();
  if (accounts.length === 0) {
    console.warn("[Phase 1] No email accounts configured in email-accounts.json");
  }

  const [imapResults, rssResult, calendarResult, todoResult] = await Promise.all([
    Promise.allSettled(accounts.map((account) => ingestImapAccount(account, runDate))),
    Promise.allSettled([ingestRssFeeds(runDate)]),
    Promise.allSettled([ingestGoogleCalendar(runDate)]),
    Promise.allSettled([ingestGoogleTasks(runDate)]),
  ]);

  const failures: SourceFailure[] = [];

  let emailCount = 0;
  for (let i = 0; i < imapResults.length; i++) {
    const r = imapResults[i];
    if (r.status === "fulfilled") {
      emailCount += r.value;
    } else {
      console.error(`[Phase 1] Account "${accounts[i].user}" failed:`, r.reason);
      failures.push({ source: `imap:${accounts[i].user}`, error: message(r.reason) });
    }
  }

  /** Unwraps a single-source settle, recording the failure and contributing 0 items. */
  const count = (name: string, settled: PromiseSettledResult<number>): number => {
    if (settled.status === "fulfilled") return settled.value;
    console.error(`[Phase 1] ${name} failed:`, settled.reason);
    failures.push({ source: name, error: message(settled.reason) });
    return 0;
  };

  const rssCount = count("rss", rssResult[0]);
  const calendarCount = count("calendar", calendarResult[0]);
  const todoCount = count("tasks", todoResult[0]);

  const sourceCount = accounts.length + 3;
  if (failures.length === sourceCount) {
    throw new Error(
      `every ingest source failed (${sourceCount}): ${failures.map((f) => `${f.source}: ${f.error}`).join("; ")}`,
    );
  }

  const result: IngestResult = {
    emailCount,
    rssCount,
    calendarCount,
    todoCount,
    total: emailCount + rssCount + calendarCount + todoCount,
    failures,
  };

  console.log(
    `[Phase 1] Done - ${result.total} items (${emailCount} email, ${rssCount} RSS, ${calendarCount} calendar, ${todoCount} todos)`
  );
  if (failures.length > 0) {
    console.warn(`[Phase 1] Degraded: ${failures.length}/${sourceCount} sources failed - ${failures.map((f) => f.source).join(", ")}`);
  }
  return result;
}

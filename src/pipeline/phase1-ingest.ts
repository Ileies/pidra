import { errMessage } from "../util/text";
import { isNotNull } from "drizzle-orm";
import { db, sourceQuality } from "../db";
import { ingestImapAccount } from "../ingest/imap";
import { ingestRssFeeds } from "../ingest/rss";
import { ingestGoogleCalendar, ingestGoogleTasks } from "../ingest/google";
import { loadEmailAccounts } from "../config/email-accounts";
import { loadNewsletterConfig } from "../config/newsletter-sources";
import { loadRssFeeds } from "../config/rss-feeds";
import { span } from "../util/trace";

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

/**
 * Phase 1: ingestion, source by source (IMAP accounts, RSS, Google Calendar, Google Tasks), writing
 * `raw_items` through `src/ingest/*`. Called by `run.ts`.
 *
 * No single source can take down the others (a revoked Google token once killed the whole run on
 * 2026-09-12): a failing source is logged, counted as zero and returned in `failures`, which
 * `run.ts` records in `step_errors`. The step throws only when *every* source failed, which is a
 * real outage rather than one expired credential.
 */
export async function runPhase1(runDate: string): Promise<IngestResult> {
  console.log(`[Phase 1] Starting ingestion for ${runDate}`);

  const [accounts, newsletterConfig, feeds, checkedUnsubscribeRows] = await Promise.all([
    loadEmailAccounts(), loadNewsletterConfig(), loadRssFeeds(),
    db.select({ sourceName: sourceQuality.sourceName }).from(sourceQuality).where(isNotNull(sourceQuality.unsubscribeCheckedAt)),
  ]);
  const rssSourceNames = new Set(feeds.map((feed) => feed.sourceName));
  // Shared across all accounts in this run, so two accounts seeing the same newsletter on the
  // same morning don't both pay for the AI fallback scan.
  const checkedUnsubscribeSources = new Set(checkedUnsubscribeRows.map((row) => row.sourceName));
  if (accounts.length === 0) {
    console.warn("[Phase 1] No email accounts configured (see /settings/email-accounts)");
  }

  const [imapResults, rssResult, calendarResult, todoResult] = await Promise.all([
    Promise.allSettled(accounts.map((account) =>
      span(`ingest:imap:${account.user}`, () => ingestImapAccount(account, runDate, newsletterConfig, rssSourceNames, checkedUnsubscribeSources)),
    )),
    Promise.allSettled([span("ingest:rss", () => ingestRssFeeds(runDate, feeds))]),
    Promise.allSettled([span("ingest:calendar", () => ingestGoogleCalendar(runDate))]),
    Promise.allSettled([span("ingest:tasks", () => ingestGoogleTasks(runDate))]),
  ]);

  const failures: SourceFailure[] = [];

  let emailCount = 0;
  for (let i = 0; i < imapResults.length; i++) {
    const r = imapResults[i];
    if (r.status === "fulfilled") {
      emailCount += r.value;
    } else {
      console.error(`[Phase 1] Account "${accounts[i].user}" failed:`, r.reason);
      failures.push({ source: `imap:${accounts[i].user}`, error: errMessage(r.reason) });
    }
  }

  /** Unwraps a single-source settle, recording the failure and contributing 0 items. */
  const count = (name: string, settled: PromiseSettledResult<number>): number => {
    if (settled.status === "fulfilled") return settled.value;
    console.error(`[Phase 1] ${name} failed:`, settled.reason);
    failures.push({ source: name, error: errMessage(settled.reason) });
    return 0;
  };

  const rssCount = rssResult[0].status === "fulfilled" ? rssResult[0].value.count : count("rss", rssResult[0]);
  if (rssResult[0].status === "fulfilled") failures.push(...rssResult[0].value.failures);
  const calendarCount = count("calendar", calendarResult[0]);
  const todoCount = count("tasks", todoResult[0]);

  const sourceCount = accounts.length + 3;
  const rssFailed = rssResult[0].status === "rejected" || (feeds.length > 0 && rssResult[0].value.failures.length === feeds.length);
  if (imapResults.every((result) => result.status === "rejected") && rssFailed &&
      calendarResult[0].status === "rejected" && todoResult[0].status === "rejected") {
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
    console.warn(`[Phase 1] Degraded: ${failures.length} source failures - ${failures.map((f) => f.source).join(", ")}`);
  }
  return result;
}

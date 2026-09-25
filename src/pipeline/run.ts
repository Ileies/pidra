import { eq } from "drizzle-orm";
import { db, pipelineRuns } from "../db";
import { runPhase1 } from "./phase1-ingest";
import { runPhase2 } from "./phase2-extract";
import { runPhase3 } from "./phase3-context";
import { runPhase4 } from "./phase4-questiongate";
import { newsItemsOf, runNewsSection, runSection1, runSection2 } from "./phase5-synthesis";
import { runPhase6 } from "./phase6-memory";
import { withRetry, StepError } from "./withRetry";
import type { StepAttemptError } from "./withRetry";
import { sendPushNotifications, sendFailureNotification } from "../push";
import { EMPTY_NEWS_DESK, runNewsDesk, type NewsDeskOutcome } from "../news/desk";
import { renderNewsFallback } from "../news/format";

/**
 * The news desks, run so that nothing downstream can be failed by them. A briefing without the
 * world in it is still worth more than no briefing, the same judgement Phase 1 makes per source,
 * so a desk step that exhausted its retries degrades to "no news" plus a recorded failure, and the
 * report says so above the briefing.
 */
async function tolerantNewsDesk(date: string): Promise<NewsDeskOutcome> {
  try {
    return await withRetry("news", () => runNewsDesk(date));
  } catch (err) {
    const error = err instanceof StepError
      ? err.attempts.at(-1)?.error ?? err.message
      : err instanceof Error ? err.message : String(err);
    console.error(`[News] Giving up on the news desks: ${error}`);
    return { ...EMPTY_NEWS_DESK, failures: [{ source: "news", error }] };
  }
}

/** The first bold phrase of the News section: the top story, as the lock screen should show it. */
function topStory(news: string): string | null {
  const match = news.match(/\*\*(.+?)\*\*/);
  return match ? match[1].replace(/^(UPDATE|Unconfirmed):\s*/i, "").trim() : null;
}

export async function runPipeline(runDate?: string): Promise<string> {
  const date = runDate ?? new Date().toISOString().split("T")[0];
  console.log(`\n=== PIDRA Pipeline - ${date} ===\n`);

  const start = Date.now();

  const [run] = await db
    .insert(pipelineRuns)
    .values({ runDate: date, status: "running" })
    .returning({ id: pipelineRuns.id });

  const markFailed = async (step: string, stepErrors: StepAttemptError[]) => {
    await db
      .update(pipelineRuns)
      .set({
        status: "failed",
        failedStep: step,
        stepErrors,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      })
      .where(eq(pipelineRuns.id, run.id));
  };

  try {
    // Started first and awaited only before Phase 3: the desks need nothing the ingest produces,
    // and at half a minute to five minutes each on the flex tier (in parallel), running them after
    // Phase 2 would add all of that to every morning. Phase 3 is where their stories meet the gate.
    const newsDesk = tolerantNewsDesk(date);
    const ingest = await withRetry("phase1", () => runPhase1(date));
    await withRetry("phase2", () => runPhase2(date));
    const news = await newsDesk;
    const ctx = await withRetry("phase3", () => runPhase3(date, news));
    const gate = await withRetry("phase4", () => runPhase4(date));

    // Section 1, the News section and the question gate wait run in parallel.
    // Section 2 blocks until the gate resolves or times out.
    const editorErrors: StepAttemptError[] = [];
    const [s1, newsSection, questionAnswers] = await Promise.all([
      withRetry("phase5-section1", () => runSection1(ctx, date)),
      // The editor is the one step here with a fallback that loses nothing but polish: the
      // stories are checked and stored already, so they are written out as they stand.
      withRetry("phase5-news", () => runNewsSection(ctx, date)).catch((err) => {
        if (err instanceof StepError) editorErrors.push(...err.attempts);
        console.error("[Phase 5] News editor failed, writing the section from the stories directly:", err);
        return { text: renderNewsFallback(newsItemsOf(ctx.newsItems), ctx.newsDesk.home), tokensIn: 0, tokensOut: 0, aiCalls: 0 };
      }),
      gate.waitForAnswers(),
    ]);
    const s2 = await withRetry("phase5-section2", () => runSection2(ctx, date, questionAnswers));

    const synthesis = {
      section1: s1.text,
      section2: s2.text,
      news: newsSection.text,
      tokensIn: s1.tokensIn + s2.tokensIn + newsSection.tokensIn + news.tokensIn,
      tokensOut: s1.tokensOut + s2.tokensOut + newsSection.tokensOut + news.tokensOut,
      aiCalls: 2 + newsSection.aiCalls + news.aiCalls,
    };

    const report = await withRetry("phase6", () =>
      runPhase6(
        date,
        synthesis,
        ctx.newsletterItems.length + ctx.personalItems.length + ctx.newsItems.length,
        ctx.newsletterItems.length + ctx.newsItems.length,
        gate.fired,
        ctx.webSearchResults.length + news.searchCalls,
      )
    );

    const durationMs = Date.now() - start;
    const ts = new Date().toISOString();
    // A run that produced a briefing without one of its sources is a success, but not a clean one.
    // The failures ride along in `step_errors` so `/runs` can show them; the status stays
    // "completed" because a report was written and the dashboard should not cry wolf about it.
    // A news desk that failed is such a source: its step is "news", which is what the dashboard's
    // `ingestFailures` reads besides "phase1", so the gap is stated above the briefing too.
    await db
      .update(pipelineRuns)
      .set({
        status: "completed",
        completedAt: ts,
        durationMs,
        stepErrors: [
          ...ingest.failures.map((f) => ({ step: "phase1", attempt: 1, error: `${f.source}: ${f.error}`, ts })),
          ...news.failures.map((f) => ({ step: "news", attempt: 1, error: `${f.source}: ${f.error}`, ts })),
          ...editorErrors,
        ],
      })
      .where(eq(pipelineRuns.id, run.id));

    // The top story when there is one: it is what the reader most needs from a lock screen, and
    // it is public news rather than anything personal.
    const notificationSummary = topStory(synthesis.news) ?? synthesis.section1
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ")
      .slice(0, 120);
    // Awaited, and that is the whole point. Fire-and-forget meant the promise was still in flight
    // when runPipeline returned, job.ts logged, and the one-shot process exited - taking the
    // in-flight FCM requests with it. The success notification had therefore never been delivered
    // once: not on 2026-09-10, not on 2026-09-12. There is no `[push]` line in any journal entry
    // for a completed run, while the awaited failure path logged "Sent 3/4" the first morning it
    // existed. A few seconds of latency at the very end of a 79 s run costs nothing.
    await sendPushNotifications(
      date,
      notificationSummary,
      [...ingest.failures, ...news.failures].map((f) => f.source),
    ).catch(console.error);

    console.log(`\n=== Pipeline complete in ${Math.round(durationMs / 1000)}s ===\n`);
    return report;
  } catch (err) {
    const step = err instanceof StepError ? err.step : "unknown";
    const stepErrors = err instanceof StepError ? err.attempts : [];
    await markFailed(step, stepErrors);
    // Awaited, unlike the success notification: nothing runs after this but the rethrow, and a
    // fire-and-forget send would race the process exiting under systemd.
    await sendFailureNotification(date, step).catch(console.error);
    console.error(`\n=== Pipeline FAILED at ${step} in ${Math.round((Date.now() - start) / 1000)}s ===\n`);
    throw err;
  }
}

// Run directly: bun run src/pipeline/run.ts
if (import.meta.main) {
  runPipeline()
    .then((report) => {
      console.log("\n--- REPORT PREVIEW (first 500 chars) ---");
      console.log(report.slice(0, 500));
    })
    .catch(console.error);
}

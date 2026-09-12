import { eq } from "drizzle-orm";
import { db, pipelineRuns } from "../db";
import { runPhase1 } from "./phase1-ingest";
import { runPhase2 } from "./phase2-extract";
import { runPhase3 } from "./phase3-context";
import { runPhase4 } from "./phase4-questiongate";
import { runSection1, runSection2 } from "./phase5-synthesis";
import { runPhase6 } from "./phase6-memory";
import { withRetry, StepError } from "./withRetry";
import type { StepAttemptError } from "./withRetry";
import { sendPushNotifications, sendFailureNotification } from "../push";

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
    const ingest = await withRetry("phase1", () => runPhase1(date));
    await withRetry("phase2", () => runPhase2(date));
    const ctx = await withRetry("phase3", () => runPhase3(date));
    const gate = await withRetry("phase4", () => runPhase4(date));

    // Section 1 and question gate wait run in parallel.
    // Section 2 blocks until the gate resolves or times out.
    const [s1, questionAnswers] = await Promise.all([
      withRetry("phase5-section1", () => runSection1(ctx, date)),
      gate.waitForAnswers(),
    ]);
    const s2 = await withRetry("phase5-section2", () => runSection2(ctx, date, questionAnswers));

    const synthesis = {
      section1: s1.text,
      section2: s2.text,
      tokensIn: s1.tokensIn + s2.tokensIn,
      tokensOut: s1.tokensOut + s2.tokensOut,
    };

    const report = await withRetry("phase6", () =>
      runPhase6(
        date,
        synthesis,
        ctx.newsletterItems.length + ctx.personalItems.length,
        ctx.newsletterItems.length,
        gate.fired,
        ctx.webSearchResults.length,
      )
    );

    const durationMs = Date.now() - start;
    // A run that produced a briefing without one of its sources is a success, but not a clean one.
    // The failures ride along in `step_errors` so `/runs` can show them; the status stays
    // "completed" because a report was written and the dashboard should not cry wolf about it.
    await db
      .update(pipelineRuns)
      .set({
        status: "completed",
        completedAt: new Date().toISOString(),
        durationMs,
        stepErrors: ingest.failures.map((f) => ({
          step: "phase1",
          attempt: 1,
          error: `${f.source}: ${f.error}`,
          ts: new Date().toISOString(),
        })),
      })
      .where(eq(pipelineRuns.id, run.id));

    const notificationSummary = synthesis.section1
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
    await sendPushNotifications(date, notificationSummary).catch(console.error);

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

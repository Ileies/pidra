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
import { sendPushNotifications } from "../push";

export async function runPipeline(runDate?: string): Promise<string> {
  const date = runDate ?? new Date().toISOString().split("T")[0];
  console.log(`\n=== PIDRA Pipeline — ${date} ===\n`);

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
    await withRetry("phase1", () => runPhase1(date));
    await withRetry("phase2", () => runPhase2(date));
    const ctx = await withRetry("phase3", () => runPhase3(date));
    const gate = await withRetry("phase4", () => runPhase4(date));

    // Section 1 and question gate wait run in parallel.
    // Section 2 blocks until the gate resolves or times out.
    const [s1, questionAnswers] = await Promise.all([
      withRetry("phase5-section1", () => runSection1(ctx)),
      gate.waitForAnswers(),
    ]);
    const s2 = await withRetry("phase5-section2", () => runSection2(ctx, questionAnswers));

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
      )
    );

    const durationMs = Date.now() - start;
    await db
      .update(pipelineRuns)
      .set({ status: "completed", completedAt: new Date().toISOString(), durationMs })
      .where(eq(pipelineRuns.id, run.id));

    const notificationSummary = synthesis.section1
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ")
      .slice(0, 120);
    sendPushNotifications(date, notificationSummary).catch(console.error);

    console.log(`\n=== Pipeline complete in ${Math.round(durationMs / 1000)}s ===\n`);
    return report;
  } catch (err) {
    const step = err instanceof StepError ? err.step : "unknown";
    const stepErrors = err instanceof StepError ? err.attempts : [];
    await markFailed(step, stepErrors);
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

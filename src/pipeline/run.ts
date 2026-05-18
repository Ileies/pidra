import { eq } from "drizzle-orm";
import { db, pipelineRuns } from "../db";
import { runPhase1 } from "./phase1-ingest";
import { runPhase2 } from "./phase2-extract";
import { runPhase3 } from "./phase3-context";
import { runPhase5 } from "./phase5-synthesis";
import { runPhase6 } from "./phase6-memory";
import { withRetry, StepError } from "./withRetry";
import type { StepAttemptError } from "./withRetry";

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
    const synthesis = await withRetry("phase5", () => runPhase5(ctx));
    const report = await withRetry("phase6", () =>
      runPhase6(
        date,
        synthesis,
        ctx.newsletterItems.length + ctx.personalItems.length,
        ctx.newsletterItems.length
      )
    );

    const durationMs = Date.now() - start;
    await db
      .update(pipelineRuns)
      .set({ status: "completed", completedAt: new Date().toISOString(), durationMs })
      .where(eq(pipelineRuns.id, run.id));

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

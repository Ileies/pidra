/**
 * Shapes the pipeline writes that the dashboard reads back.
 *
 * `withRetry` records one of these per failed attempt into `pipeline_runs.step_errors`, which is
 * what makes a failure inspectable rather than just "failed". Mirrors `src/pipeline/withRetry.ts`.
 */
export interface StepAttempt {
  step: string;
  attempt: number;
  error: string;
  stack?: string;
  ts: string;
}

export type RunStatus = "running" | "completed" | "failed";

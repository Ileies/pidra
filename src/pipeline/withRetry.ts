import type { StepAttemptError } from "../db/schema";

export type { StepAttemptError };

export class StepError extends Error {
  step: string;
  attempts: StepAttemptError[];

  constructor(step: string, attempts: StepAttemptError[]) {
    super(`${step} failed after ${attempts.length} attempt(s): ${attempts.at(-1)?.error}`);
    this.name = "StepError";
    this.step = step;
    this.attempts = attempts;
  }
}

const RETRY_DELAYS_MS = [2000, 5000];

export async function withRetry<T>(
  step: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  const attempts: StepAttemptError[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[${step}] Attempt ${attempt}/${maxAttempts}…`);
      }
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      attempts.push({
        step,
        attempt,
        error: error.message,
        stack: error.stack,
        ts: new Date().toISOString(),
      });
      console.error(`[${step} — attempt ${attempt}/${maxAttempts}] FAILED: ${error.message}`);

      if (attempt < maxAttempts) {
        await Bun.sleep(RETRY_DELAYS_MS[attempt - 1] ?? 5000);
      }
    }
  }

  throw new StepError(step, attempts);
}

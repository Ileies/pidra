import type { StepAttemptError } from "../db/schema";
import { retry } from "../util/retry";
import { span } from "../util/trace";

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

  try {
    return await retry(
      async (attempt) => {
        if (attempt > 1) console.log(`[${step}] Attempt ${attempt}/${maxAttempts}…`);
        try {
          return await span(step, fn, attempt);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          attempts.push({ step, attempt, error: error.message, stack: error.stack, ts: new Date().toISOString() });
          console.error(`[${step} - attempt ${attempt}/${maxAttempts}] FAILED: ${error.message}`);
          throw err;
        }
      },
      { attempts: maxAttempts, delay: (failed) => RETRY_DELAYS_MS[failed - 1] ?? 5000 },
    );
  } catch {
    throw new StepError(step, attempts);
  }
}

/**
 * `withRetry` for a step the run can do without: when the retries are used up its attempts go to
 * `errors` (for `step_errors` on /runs), `failureMessage` is logged, and `fallback()` stands in.
 */
export async function tolerant<T, F>(
  step: string,
  fn: () => Promise<T>,
  fallback: () => F | Promise<F>,
  errors: StepAttemptError[],
  failureMessage: string,
): Promise<T | F> {
  try {
    return await withRetry(step, fn);
  } catch (err) {
    if (err instanceof StepError) errors.push(...err.attempts);
    console.error(failureMessage, err);
    return fallback();
  }
}

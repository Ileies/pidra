export interface RetryOptions {
  /** Total tries, the first included. */
  attempts: number;
  /** Milliseconds to wait after the nth failure (1-based): a list, or a function of the failure. */
  delay: number[] | ((failed: number, err: unknown) => number);
  /** Return false to give up at once. Default: every error is retried. */
  shouldRetry?: (err: unknown) => boolean;
  /** Runs before the wait, once per retry. */
  onRetry?: (err: unknown, failed: number) => void;
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.attempts || opts.shouldRetry?.(err) === false) throw err;
      opts.onRetry?.(err, attempt);
      const wait = typeof opts.delay === "function" ? opts.delay(attempt, err) : (opts.delay[attempt - 1] ?? opts.delay.at(-1) ?? 0);
      await Bun.sleep(wait);
    }
  }
}

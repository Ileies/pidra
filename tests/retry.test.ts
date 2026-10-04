import { describe, expect, test } from "bun:test";
import { retry } from "../src/util/retry";
import { StepError, tolerant, withRetry, type StepAttemptError } from "../src/pipeline/withRetry";

describe("retry", () => {
  test("returns the first success without waiting", async () => {
    expect(await retry(async () => "ok", { attempts: 3, delay: [1] })).toBe("ok");
  });

  test("retries until it succeeds, passing the attempt number", async () => {
    const seen: number[] = [];
    const result = await retry(async (attempt) => {
      seen.push(attempt);
      if (attempt < 3) throw new Error("not yet");
      return attempt;
    }, { attempts: 3, delay: [1, 1] });
    expect(result).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  test("throws the last error once the attempts are used up", async () => {
    let calls = 0;
    await expect(retry(async () => { throw new Error(`fail ${++calls}`); }, { attempts: 3, delay: [1] })).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });

  test("shouldRetry false gives up at once", async () => {
    let calls = 0;
    await expect(retry(async () => { calls++; throw new Error("final"); }, { attempts: 3, delay: [1], shouldRetry: () => false })).rejects.toThrow("final");
    expect(calls).toBe(1);
  });

  test("onRetry runs once per retry and delay can depend on the failure", async () => {
    const retried: number[] = [];
    const waits: number[] = [];
    await expect(retry(async () => { throw new Error("x"); }, {
      attempts: 3,
      delay: (failed) => { waits.push(failed); return 1; },
      onRetry: (_err, failed) => retried.push(failed),
    })).rejects.toThrow("x");
    expect(retried).toEqual([1, 2]);
    expect(waits).toEqual([1, 2]);
  });
});

describe("withRetry and tolerant", () => {
  test("a step that never succeeds becomes a StepError listing every attempt", async () => {
    const err = await withRetry("t-step", async () => { throw new Error("boom"); }, 1).catch((e) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err.step).toBe("t-step");
    expect(err.attempts).toHaveLength(1);
    expect(err.attempts[0].error).toBe("boom");
  });

  test("tolerant passes a successful result through and records nothing", async () => {
    const errors: StepAttemptError[] = [];
    expect(await tolerant("t-step", async () => 42, () => "fallback", errors, "failed:")).toBe(42);
    expect(errors).toEqual([]);
  });
});

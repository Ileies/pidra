/**
 * Step timing for a pipeline run, written to `pipeline_run_steps` and drawn on `/runs/[id]`.
 *
 * `traceRun` opens the root span; `span` opens a child of the current span (found via
 * `AsyncLocalStorage`, so parallel branches nest correctly). Outside a run both are a plain call.
 * Called by `recordUsage`/`recordAiCall`/`recordFlexRetry` from ai/openai.ts and `recordSearch`
 * from the Brave client. Counters are the span's own values (the dashboard sums descendants).
 * Measurement must never cost a briefing: every DB write here is swallowed.
 */
import { errMessage } from "./text";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

interface Span {
  id: string;
  runId: string;
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
  searchCalls: number;
  flexRetries: number;
  detail: Record<string, unknown> | null;
}

const current = new AsyncLocalStorage<Span>();

async function persist(write: (steps: typeof import("../db")) => Promise<unknown>): Promise<void> {
  try {
    await write(await import("../db"));
  } catch (err) {
    console.warn(`[trace] step timing not recorded: ${errMessage(err)}`);
  }
}

async function open<T>(
  runId: string,
  parentId: string | null,
  step: string,
  attempt: number,
  fn: () => Promise<T>,
): Promise<T> {
  const s: Span = {
    id: randomUUID(), runId, tokensIn: 0, tokensOut: 0, aiCalls: 0, searchCalls: 0, flexRetries: 0, detail: null,
  };
  const startedAt = new Date();
  const t0 = performance.now();

  await persist(({ db, pipelineRunSteps }) =>
    db.insert(pipelineRunSteps).values({ id: s.id, runId, parentId, step, attempt, startedAt: startedAt.toISOString() }),
  );

  const finish = (status: "ok" | "failed") =>
    persist(({ db, pipelineRunSteps }) =>
      db
        .update(pipelineRunSteps)
        .set({
          status,
          endedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - t0),
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          aiCalls: s.aiCalls,
          searchCalls: s.searchCalls,
          flexRetries: s.flexRetries,
          detail: s.detail,
        })
        .where(eq(pipelineRunSteps.id, s.id)),
    );

  try {
    const result = await current.run(s, fn);
    await finish("ok");
    return result;
  } catch (err) {
    await finish("failed");
    throw err;
  }
}

/** Opens the root span of a run. Everything started inside `fn` nests under it. */
export function traceRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return open(runId, null, "run", 1, fn);
}

/** Measures `fn` as a child of the current span; a plain call when no run is being traced. */
export function span<T>(step: string, fn: () => Promise<T>, attempt = 1): Promise<T> {
  const parent = current.getStore();
  return parent ? open(parent.runId, parent.id, step, attempt, fn) : fn();
}

/** Merges facts about the current span (how many questions it waited on, how it ended). */
export function setDetail(detail: Record<string, unknown>): void {
  const s = current.getStore();
  if (s) s.detail = { ...s.detail, ...detail };
}

export function recordUsage(tokensIn: number, tokensOut: number): void {
  const s = current.getStore();
  if (!s) return;
  s.tokensIn += tokensIn;
  s.tokensOut += tokensOut;
}

export function recordAiCall(): void {
  const s = current.getStore();
  if (s) s.aiCalls++;
}

export function recordSearch(): void {
  const s = current.getStore();
  if (s) s.searchCalls++;
}

export function recordFlexRetry(): void {
  const s = current.getStore();
  if (s) s.flexRetries++;
}

/** The run being traced, or null outside one (a dry run, a script). */
export function currentRunId(): string | null {
  return current.getStore()?.runId ?? null;
}

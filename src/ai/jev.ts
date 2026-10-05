/**
 * Server-only Jev boundary. A decision never changes the pipeline unless its caller opts in.
 * Proposed, not authorized: nothing in the pipeline calls it yet (see JEV_INTEGRATION_PLAN.md).
 * Per-task mode comes from env `JEV_MODE_<TASK>` (off | shadow | active; default off). Not an OpenAI
 * client, so the OpenAI-only rules (`store: false`, flex) do not apply here.
 */
import { errMessage } from "../util/text";
import {
  APIError, APITimeoutError, APIUserAbortError, TypeSafeClient,
  type EntryType, type Fetch, type Questions, type SystemOneResult,
} from "@typesafe-ai/sdk";

export const JEV_MODEL = "jev-1.13.0";
export type JevTask = "news_impact" | "news_novelty" | "news_duplicate" | "newsletter_ranking";
export type JevMode = "off" | "shadow" | "active";
export type JevErrorCode = "missing_key" | "deadline" | "cancelled" | "timeout" | "rate_limit" | "provider" | "invalid_response";

export interface JevRequest<Q extends Questions> {
  task: JevTask;
  rubricVersion: string;
  state: EntryType;
  questions: Q;
  signal?: AbortSignal;
  /** May shorten the production deadline, for a caller or synthetic timeout test. */
  deadlineMs?: number;
  /** Transport injection for synthetic tests only. The production caller leaves this unset. */
  fetch?: Fetch;
}

export type JevResult<Q extends Questions> =
  | { status: "off"; task: JevTask; mode: "off"; model: typeof JEV_MODEL; rubricVersion: string }
  | { status: "ok"; task: JevTask; mode: "shadow" | "active"; model: typeof JEV_MODEL; rubricVersion: string;
      answers: SystemOneResult<Q>["answers"]; tokensIn: number; tokensOut: number; latencyMs: number }
  | { status: "error"; task: JevTask; mode: "shadow" | "active"; model: typeof JEV_MODEL; rubricVersion: string;
      code: JevErrorCode; message: string; latencyMs: number };

const MAX_CONCURRENT = 4;
const DEADLINE_MS = 20_000;
let active = 0;
const waiting: (() => void)[] = [];

function modeFor(task: JevTask): JevMode {
  const value = process.env[`JEV_MODE_${task.toUpperCase()}`]?.trim().toLowerCase();
  return value === "shadow" || value === "active" ? value : "off";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function distribution(value: unknown, keys: string[]): boolean {
  if (!record(value)) return false;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !probability(value[key]))) return false;
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  return Math.abs(Object.values(value).reduce<number>((sum, part) => sum + (part as number), 0) - 1) <= 0.02;
}

/** The SDK types are compile-time only; provider JSON must be checked before use. */
export function validJevResponse<Q extends Questions>(value: unknown, questions: Q): value is SystemOneResult<Q> {
  if (!record(value) || value.model !== JEV_MODEL || !record(value.answers) || !record(value.usage)) return false;
  if (!Number.isInteger(value.usage.input_tokens) || (value.usage.input_tokens as number) < 0 ||
      !Number.isInteger(value.usage.output_tokens) || (value.usage.output_tokens as number) < 0) return false;
  const expected = Object.keys(questions);
  if (Object.keys(value.answers).length !== expected.length) return false;
  for (const name of expected) {
    const question = questions[name];
    const answer = value.answers[name];
    if (!question || !record(answer) || answer.type !== question.type) return false;
    if (question.type === "noul") {
      if (!probability(answer.noul)) return false;
    } else if (question.type === "choice") {
      const keys = Object.keys(question.criteria);
      if (typeof answer.choice !== "string" || !keys.includes(answer.choice) ||
          !probability(answer.confidence) || !distribution(answer.probabilities, keys)) return false;
    } else {
      const keys = question.criteria.map((_, index) => String(index));
      const legend = answer.legend;
      if (!record(legend)) return false;
      if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
          answer.score < 0 || answer.score > question.criteria.length - 1 ||
          !probability(answer.confidence) || !distribution(answer.probabilities, keys) ||
          Object.keys(legend).length !== keys.length ||
          keys.some((key) => !(key in legend))) return false;
    }
  }
  return true;
}

async function acquire(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = waiting.indexOf(grant);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      active++;
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    waiting.push(grant);
  });
}

function release(): void {
  active--;
  waiting.shift()?.();
}

export async function runJevDecision<Q extends Questions>(request: JevRequest<Q>): Promise<JevResult<Q>> {
  const mode = modeFor(request.task);
  const base = { task: request.task, model: JEV_MODEL, rubricVersion: request.rubricVersion } as const;
  if (mode === "off") return { ...base, mode, status: "off" };

  const started = Date.now();
  const fail = (code: JevErrorCode, message: string): JevResult<Q> =>
    ({ ...base, mode, status: "error", code, message, latencyMs: Date.now() - started });
  const key = process.env.JEV_KEY?.trim();
  if (!key) return fail("missing_key", "JEV_KEY is not set");

  const requestedDeadline = request.deadlineMs;
  const deadlineMs = requestedDeadline !== undefined && Number.isFinite(requestedDeadline)
    ? Math.min(DEADLINE_MS, Math.max(1, Math.floor(requestedDeadline)))
    : DEADLINE_MS;
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = request.signal ? AbortSignal.any([deadline, request.signal]) : deadline;
  let acquired = false;
  try {
    await acquire(signal);
    acquired = true;
    const client = new TypeSafeClient({
      apiKey: key,
      defaultModel: JEV_MODEL,
      timeout: Math.min(8_000, deadlineMs),
      retry: { maxRetries: 2 },
      ...(request.fetch ? { fetch: request.fetch } : {}),
    });
    const response = await client.systemOne({
      state: request.state,
      model: JEV_MODEL,
      questions: request.questions,
    }, { signal });
    if (!validJevResponse(response, request.questions)) return fail("invalid_response", "Jev returned an invalid answer or usage record");
    return {
      ...base, mode, status: "ok", answers: response.answers,
      tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (deadline.aborted) return fail("deadline", "Jev call exceeded its total deadline");
    if (request.signal?.aborted || error instanceof APIUserAbortError) return fail("cancelled", "Jev call was cancelled");
    if (error instanceof APITimeoutError) return fail("timeout", "Jev request timed out");
    if (error instanceof APIError && error.status === 429) return fail("rate_limit", "Jev rate limit after retries");
    if (error instanceof APIError) return fail("provider", `Jev API status ${error.status}`);
    return fail("provider", errMessage(error));
  } finally {
    if (acquired) release();
  }
}

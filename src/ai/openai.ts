import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type { FunctionTool, ResponseInput, ResponseInputItem } from "openai/resources/responses/responses";
import { stripControlChars } from "../util/text";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EXTRACTION_MODEL = process.env.OPENAI_MODEL_EXTRACTION ?? "gpt-5.6-luna";
export const SYNTHESIS_MODEL = process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-5.6-luna";
/** The news desks' web-search calls. Defaults to the synthesis model, which is what was probed. */
export const RESEARCH_MODEL = process.env.OPENAI_MODEL_RESEARCH ?? SYNTHESIS_MODEL;

// gpt-5.6-luna rejects `temperature` and `max_tokens` with a hard 400. Determinism comes from
// strict JSON schemas plus low reasoning effort instead; the output cap is `max_output_tokens`
// on the Responses API and `max_completion_tokens` on Chat Completions.

// Flex processing trades latency for ~50% lower cost; 429s mean "no flex capacity right now",
// not a real failure, so retry with backoff instead of counting it against callers. Transient
// 5xx and connection resets get the same treatment - a several-hundred-item run will hit them.
const FLEX_RETRY_DELAYS_MS = [2000, 8000, 20000];

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  // APIConnectionError / APIConnectionTimeoutError carry no status.
  const name = (err as { name?: string }).name ?? "";
  return name === "APIConnectionError" || name === "APIConnectionTimeoutError";
}

export async function withFlexRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i <= FLEX_RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable(err) && i < FLEX_RETRY_DELAYS_MS.length) {
        await Bun.sleep(FLEX_RETRY_DELAYS_MS[i]);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export interface ExtractOptions {
  /**
   * Strict JSON schema for the response. Strongly preferred over free-form JSON: the model is
   * constrained to exactly these fields, which removes both field drift and the truncated-JSON
   * parse failures that plagued the local-model extraction path.
   */
  schema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onUsage?: (tokensIn: number, tokensOut: number) => void;
}

export async function extractJson<T>(
  systemPrompt: string,
  userContent: string,
  opts: ExtractOptions = {},
): Promise<T> {
  const format = opts.schema
    ? { type: "json_schema" as const, name: opts.schema.name, strict: true, schema: opts.schema.schema }
    : { type: "json_object" as const };

  const input = `Return JSON only.\n\n${stripControlChars(userContent)}`;
  const baseCap = opts.maxOutputTokens ?? 2000;

  // Structured outputs does NOT enforce `maxItems`, so the model can occasionally run away
  // generating an array - observed emitting 4000 tokens for a note whose correct answer was
  // 325 characters, then failing as `incomplete`. It is sporadic rather than input-dependent:
  // the identical request succeeds on a retry. So retry once with a much larger ceiling, which
  // both absorbs a genuinely long answer and re-rolls a runaway.
  const caps = [baseCap, baseCap * 4];
  let lastReason = "unknown";

  for (const cap of caps) {
    const response = await withFlexRetry(() =>
      openai.responses.create({
        model: EXTRACTION_MODEL,
        store: false,
        service_tier: "flex",
        reasoning: { effort: opts.reasoningEffort ?? "low" },
        instructions: systemPrompt,
        // json_object and json_schema both require the literal word "json" in the input.
        input,
        max_output_tokens: cap,
        text: { format },
      })
    );

    opts.onUsage?.(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

    // A truncated response can still be JSON-shaped, so check status explicitly rather than
    // letting JSON.parse fail with a confusing message.
    if (response.status === "incomplete") {
      lastReason = response.incomplete_details?.reason ?? "unknown";
      continue;
    }

    const content = response.output_text;
    if (!content) throw new Error("Empty response from OpenAI extraction");
    return JSON.parse(content) as T;
  }

  throw new Error(`OpenAI extraction incomplete after ${caps.length} attempts: ${lastReason}`);
}

export interface SynthesizeOptions {
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onUsage?: (tokensIn: number, tokensOut: number) => void;
}

export async function synthesize(
  systemPrompt: string,
  userContent: string,
  opts: SynthesizeOptions = {},
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const response = await withFlexRetry(() =>
    openai.responses.create({
      model: SYNTHESIS_MODEL,
      store: false,
      service_tier: "flex",
      reasoning: { effort: opts.reasoningEffort ?? "medium" },
      instructions: systemPrompt,
      input: stripControlChars(userContent),
      max_output_tokens: opts.maxOutputTokens ?? 4096,
    })
  );

  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;
  opts.onUsage?.(tokensIn, tokensOut);

  return { text: response.output_text, tokensIn, tokensOut };
}

export interface ResearchOptions {
  /** Required, unlike extraction: a research answer is only usable in a shape the caller can check. */
  schema: { name: string; schema: Record<string, unknown> };
  /**
   * Approximate location for localising results. Leave it out for a desk that should see the
   * world rather than one country's view of it.
   */
  userLocation?: { city?: string | null; region?: string | null; country?: string | null; timezone?: string | null };
  searchContextSize?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface ResearchResult<T> {
  data: T;
  /** Every query the model ran, in order. */
  queries: string[];
  /**
   * Every URL the search tool returned or opened. The only URLs a claim can honestly cite, which
   * is what makes a fabricated story checkable without a second model call.
   */
  sources: string[];
  /** `web_search_call` items, which is the unit the tool is billed by. */
  searchCalls: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * One web-search-backed call with a strict JSON answer. Probed on 2026-09-25 against
 * gpt-5.6-luna: `web_search` works on the flex tier with `store: false` and a strict schema, took
 * 50-60 s, and ran 16-24 queries across 4-6 search calls. JSON output carries no `url_citation`
 * annotations, so the consulted URLs come from `web_search_call.action.sources` instead.
 */
export async function researchJson<T>(
  systemPrompt: string,
  userContent: string,
  opts: ResearchOptions,
): Promise<ResearchResult<T>> {
  const input = `Return JSON only.\n\n${stripControlChars(userContent)}`;
  const baseCap = opts.maxOutputTokens ?? 16000;
  // Same reasoning as extractJson: a runaway array fails as `incomplete` and succeeds on a re-roll,
  // and `max_output_tokens` covers the reasoning that plans the searches as well as the answer.
  const caps = [baseCap, baseCap * 2];
  let tokensIn = 0;
  let tokensOut = 0;
  let lastReason = "unknown";

  for (const cap of caps) {
    const response = await withFlexRetry(() =>
      openai.responses.create(
        {
          model: RESEARCH_MODEL,
          store: false,
          service_tier: "flex",
          reasoning: { effort: opts.reasoningEffort ?? "medium" },
          instructions: systemPrompt,
          input,
          max_output_tokens: cap,
          tools: [{
            type: "web_search",
            search_context_size: opts.searchContextSize ?? "medium",
            ...(opts.userLocation ? { user_location: { type: "approximate" as const, ...opts.userLocation } } : {}),
          }],
          include: ["web_search_call.action.sources"],
          text: { format: { type: "json_schema", name: opts.schema.name, strict: true, schema: opts.schema.schema } },
        },
        // Flex can queue, and on the probes a desk at high effort searched for up to 294 s. Eight
        // minutes leaves room for a slow morning and is still short enough that a stuck call is
        // retried rather than holding the whole run hostage.
        { timeout: 8 * 60_000 },
      )
    );

    tokensIn += response.usage?.input_tokens ?? 0;
    tokensOut += response.usage?.output_tokens ?? 0;

    if (response.status === "incomplete") {
      lastReason = response.incomplete_details?.reason ?? "unknown";
      continue;
    }

    const content = response.output_text;
    if (!content) throw new Error("Empty response from OpenAI research");

    const searches = response.output.filter(
      (item): item is Extract<typeof item, { type: "web_search_call" }> => item.type === "web_search_call",
    );
    const queries: string[] = [];
    const sources = new Set<string>();
    for (const call of searches) {
      const action = call.action;
      if (action.type === "search") {
        queries.push(...(action.queries?.length ? action.queries : action.query ? [action.query] : []));
        for (const source of action.sources ?? []) sources.add(source.url);
      } else if (action.url) {
        sources.add(action.url);
      }
    }

    return {
      data: JSON.parse(content) as T,
      queries,
      sources: [...sources],
      searchCalls: searches.length,
      tokensIn,
      tokensOut,
    };
  }

  throw new Error(`OpenAI research incomplete after ${caps.length} attempts: ${lastReason}`);
}

export type { FunctionTool, ResponseInput, ResponseInputItem };

export interface ConverseOptions extends SynthesizeOptions {
  tools?: FunctionTool[];
}

export interface ConverseResult {
  text: string;
  /** Every item the model produced, to be fed back as input on the next turn of the loop. */
  output: ResponseInput;
  functionCalls: { callId: string; name: string; argumentsJson: string }[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * One turn of a tool-calling conversation. The caller owns the loop: it executes the returned
 * `functionCalls`, appends their `function_call_output` items to the input and calls again.
 *
 * `store: false` means the API keeps nothing between turns, so the full item list - reasoning
 * items and function calls included - has to be replayed on every call. That is why `output` is
 * handed back verbatim rather than reduced to text.
 */
export async function converse(
  systemPrompt: string,
  input: ResponseInput,
  opts: ConverseOptions = {},
): Promise<ConverseResult> {
  const response = await withFlexRetry(() =>
    openai.responses.create({
      model: SYNTHESIS_MODEL,
      store: false,
      service_tier: "flex",
      reasoning: { effort: opts.reasoningEffort ?? "low" },
      instructions: systemPrompt,
      input,
      max_output_tokens: opts.maxOutputTokens ?? 4096,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" as const } : {}),
    })
  );

  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;
  opts.onUsage?.(tokensIn, tokensOut);

  const functionCalls = response.output
    .filter((item): item is Extract<typeof item, { type: "function_call" }> => item.type === "function_call")
    .map((item) => ({ callId: item.call_id, name: item.name, argumentsJson: item.arguments }));

  return {
    text: response.output_text,
    output: response.output as ResponseInput,
    functionCalls,
    tokensIn,
    tokensOut,
  };
}

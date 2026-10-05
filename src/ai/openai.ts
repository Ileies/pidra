import OpenAI from "openai";
import type { ReasoningEffort } from "openai/resources/shared";
import type {
  FunctionTool,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { EXTRACTION_MODEL, SYNTHESIS_MODEL } from "./models";
import { retry } from "../util/retry";
import { stripControlChars } from "../util/text";
import { recordAiCall, recordFlexRetry, recordUsage } from "../util/trace";

/**
 * The single OpenAI client (CLAUDE.md "OpenAI API rules"): `extractJson` (strict-schema JSON),
 * `synthesize` (free text), `converse` (one tool-calling turn) and `speak` (TTS). Throws at import
 * when OPENAI_API_KEY is unset. Token usage is reported to util/trace.ts and the optional `onUsage`.
 */
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export { EXTRACTION_MODEL, SYNTHESIS_MODEL };

// Flex 429 means "no flex capacity right now", not a failure; 5xx and connection resets are
// retried the same way (a several-hundred-item run hits them).
const FLEX_RETRY_DELAYS_MS = [2000, 8000, 20000];

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  // APIConnectionError / APIConnectionTimeoutError carry no status.
  const name = (err as { name?: string }).name ?? "";
  return name === "APIConnectionError" || name === "APIConnectionTimeoutError";
}

export function withFlexRetry<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    attempts: FLEX_RETRY_DELAYS_MS.length + 1,
    delay: FLEX_RETRY_DELAYS_MS,
    shouldRetry: isRetryable,
    onRetry: recordFlexRetry,
  });
}

/** What every Responses call lets its caller tune, and the usage callback they all share. */
export interface CallOptions {
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  onUsage?: (tokensIn: number, tokensOut: number) => void;
}

/** Token counts for a run of calls: pass `tally.onUsage` as `onUsage` and read the totals after. */
export function usageTally() {
  const tally = {
    tokensIn: 0,
    tokensOut: 0,
    onUsage(tokensIn: number, tokensOut: number) {
      tally.tokensIn += tokensIn;
      tally.tokensOut += tokensOut;
    },
  };
  return tally;
}

/**
 * Every Responses call goes through here, so `store: false`, the flex tier, the retry and the
 * usage accounting cannot be forgotten by a new caller.
 */
async function callModel(
  params: Omit<ResponseCreateParamsNonStreaming, "store" | "service_tier">,
  onUsage?: CallOptions["onUsage"],
) {
  const response = await withFlexRetry(() =>
    openai.responses.create({ ...params, store: false, service_tier: "flex" }),
  );
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;
  recordAiCall();
  recordUsage(tokensIn, tokensOut);
  onUsage?.(tokensIn, tokensOut);
  return { response, tokensIn, tokensOut };
}

export interface ExtractOptions extends CallOptions {
  /**
   * Strict JSON schema for the response. Strongly preferred over free-form JSON: the model is
   * constrained to exactly these fields, which removes both field drift and the truncated-JSON
   * parse failures that plagued the local-model extraction path.
   */
  schema?: { name: string; schema: Record<string, unknown> };
}

/**
 * Low-effort JSON extraction on the extraction model. Returns the parsed object (cast, not validated).
 * Throws on an empty response or when the output is still `incomplete` after the retry with a 4x cap.
 * Default `maxOutputTokens` 2000, reasoning effort "low".
 */
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

  // Structured outputs does NOT enforce `maxItems`, so the model sporadically runs away on an array
  // and ends `incomplete`; an identical retry succeeds. Retry once with a 4x ceiling, which absorbs
  // a genuinely long answer and re-rolls a runaway.
  const caps = [baseCap, baseCap * 4];
  let lastReason = "unknown";

  for (const cap of caps) {
    const { response } = await callModel({
      model: EXTRACTION_MODEL,
      reasoning: { effort: opts.reasoningEffort ?? "low" },
      instructions: systemPrompt,
      // json_object and json_schema both require the literal word "json" in the input.
      input,
      max_output_tokens: cap,
      text: { format },
    }, opts.onUsage);

    // A truncated response can still be JSON-shaped, so check status before parsing.
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

/** Free-text call on the synthesis model (default effort "medium", 4096 output tokens). Does not retry on `incomplete`. */
export async function synthesize(
  systemPrompt: string,
  userContent: string,
  opts: CallOptions = {},
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const { response, tokensIn, tokensOut } = await callModel({
    model: SYNTHESIS_MODEL,
    reasoning: { effort: opts.reasoningEffort ?? "medium" },
    instructions: systemPrompt,
    input: stripControlChars(userContent),
    max_output_tokens: opts.maxOutputTokens ?? 4096,
  }, opts.onUsage);

  return { text: response.output_text, tokensIn, tokensOut };
}

export const TTS_MODEL = process.env.OPENAI_MODEL_TTS ?? "gpt-4o-mini-tts";
export const TTS_VOICE = process.env.OPENAI_TTS_VOICE ?? "cedar";

const TTS_STYLE = "Read this morning briefing aloud like a calm, clear news presenter. Steady pace, neutral tone, short pauses between items.";

/**
 * Text to speech, MP3. The one model call here that is not a Responses call: the speech endpoint
 * has no `store` and no `service_tier` parameter, so the flex tier cannot be requested. It still
 * gets the 429 and 5xx retry, and callers cache the result, so a text is spoken once.
 */
export async function speak(text: string): Promise<Buffer> {
  const response = await withFlexRetry(() =>
    openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      instructions: TTS_STYLE,
      response_format: "mp3",
    })
  );
  recordAiCall();
  return Buffer.from(await response.arrayBuffer());
}

export type { FunctionTool, ResponseInput, ResponseInputItem };

export interface ConverseOptions extends CallOptions {
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
 * One turn of a tool-calling conversation (used by src/ai/chat). The caller owns the loop: execute
 * `functionCalls`, append `function_call_output` items and call again. With `store: false` the full
 * item list (reasoning items included) must be replayed each turn, hence `output` is returned verbatim.
 */
export async function converse(
  systemPrompt: string,
  input: ResponseInput,
  opts: ConverseOptions = {},
): Promise<ConverseResult> {
  const { response, tokensIn, tokensOut } = await callModel({
    model: SYNTHESIS_MODEL,
    reasoning: { effort: opts.reasoningEffort ?? "low" },
    instructions: systemPrompt,
    input,
    max_output_tokens: opts.maxOutputTokens ?? 4096,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" as const } : {}),
  }, opts.onUsage);

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

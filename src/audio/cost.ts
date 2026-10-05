/**
 * Cost of speaking one chunk of text, from OpenAI's list prices for `gpt-4o-mini-tts`. The speech
 * endpoint reports no usage, so both sides are estimated: input from the text length, output from
 * the length of the MP3 that came back. Stored by `store.ts` in `pipeline_runs.audio_cost_usd`.
 */

const PRICE_IN_PER_MTOK = 0.6;
/** Audio output: $12 per 1M tokens, which OpenAI rounds to about $0.015 per minute. */
const PRICE_AUDIO_OUT_PER_MIN = 0.015;
/** Measured on a spoken report (docs/operations.md): 7,777 characters were 1,611 tokens. */
const CHARS_PER_TOKEN = 4.8;

export function speechCostUsd(chars: number, durationMs: number): number {
  const input = chars / CHARS_PER_TOKEN / 1_000_000 * PRICE_IN_PER_MTOK;
  const output = durationMs / 60_000 * PRICE_AUDIO_OUT_PER_MIN;
  return input + output;
}

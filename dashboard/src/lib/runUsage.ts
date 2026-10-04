import { costUsd, PRICING_CONFIGURED } from "#lib/pricing.js";
import type { GroupTotal, StepTotal, Usage } from "#lib/runTrace.js";

/** What a share is a share *of*: dollars when priced, tokens otherwise. */
export function weight(tokensIn: number, tokensOut: number): number {
  return PRICING_CONFIGURED ? (costUsd(tokensIn, tokensOut) ?? 0) : tokensIn + tokensOut;
}

export function withWeights(groups: GroupTotal[]): (GroupTotal & { weight: number })[] {
  return groups.map((entry) => ({ ...entry, weight: weight(entry.tokensIn, entry.tokensOut) }));
}

/** Steps that did any model or search work, heaviest first. */
export function busySteps(steps: StepTotal[]): StepTotal[] {
  return steps
    .filter((entry) => entry.aiCalls + entry.searchCalls + entry.tokensIn + entry.tokensOut > 0)
    .sort((a, b) => weight(b.tokensIn, b.tokensOut) - weight(a.tokensIn, a.tokensOut));
}

export function sumUsage(steps: Usage[]) {
  return steps.reduce(
    (sum, entry) => ({
      tokensIn: sum.tokensIn + entry.tokensIn,
      tokensOut: sum.tokensOut + entry.tokensOut,
      aiCalls: sum.aiCalls + entry.aiCalls,
      searchCalls: sum.searchCalls + entry.searchCalls,
      flexRetries: sum.flexRetries + entry.flexRetries,
    }),
    { tokensIn: 0, tokensOut: 0, aiCalls: 0, searchCalls: 0, flexRetries: 0 },
  );
}

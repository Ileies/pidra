// Section 1's repeat judge: compares the newsletter items handed to Section 1 with what the reader
// was already told (earlier reports and today's News section) before synthesis sees them, using the
// news desks' `news_dedup` prompt and schema. Called by `phase5-synthesis.ts`.
import { activePrompt } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";
import { REPEAT_SCHEMA, type Judgement } from "../news/judge";
import type { ReportedStory } from "../news/validate";
import { errMessage, squash } from "../util/text";
import type { ExtractionWithSource } from "./gate-items";

export interface Section1Verdict {
  /** Extraction ids that only repeat a told story: left out of synthesis. */
  repeats: Set<string>;
  /** Extraction ids that add a new fact to a told story, with the story they update. */
  updates: Map<string, { date: string; headline: string }>;
  /** Extraction ids reporting the same event as another of today's items, to a shared group key. */
  groups: Map<string, string>;
}

interface Claim { headline?: string; key_claim?: string }

/** Pure: maps the judge's short ids ("c1", "t1") back to items. Ids the model invented are ignored. */
export function readJudgement(items: { id: string }[], told: ReportedStory[], judgement: Judgement): Section1Verdict {
  const itemById = new Map(items.map((item, i) => [`c${i + 1}`, item.id]));
  const toldById = new Map(told.map((t, i) => [`t${i + 1}`, t]));
  const verdict: Section1Verdict = { repeats: new Set(), updates: new Map(), groups: new Map() };

  for (const { id, told_id, adds_new_fact } of judgement.repeats ?? []) {
    const itemId = itemById.get(id);
    const prior = toldById.get(told_id);
    if (!itemId || !prior) continue;
    if (adds_new_fact) verdict.updates.set(itemId, { date: prior.date, headline: prior.headline });
    else verdict.repeats.add(itemId);
  }
  (judgement.groups ?? []).forEach(({ ids }, g) => {
    const members = [...new Set(ids)].flatMap((id) => (itemById.has(id) ? [itemById.get(id)!] : []));
    if (members.length < 2) return;
    for (const member of members) verdict.groups.set(member, `g${g + 1}`);
  });
  return verdict;
}

/**
 * Judges `items` against `told`. Null when there was nothing to judge or the call failed: Section 1
 * then runs on every item, as before the judge existed. Never throws.
 */
export async function judgeSection1Repeats(
  items: ExtractionWithSource[],
  told: ReportedStory[],
  usage: { tokensIn: number; tokensOut: number },
): Promise<Section1Verdict | null> {
  if (items.length === 0 || (told.length === 0 && items.length < 2)) return null;
  const payload = JSON.stringify({
    candidates: items.map((item, i) => {
      const claim = item.extraction.extractedJson as Claim | null;
      return { id: `c${i + 1}`, desk: "newsletter", headline: claim?.headline ?? "", summary: squash(claim?.key_claim ?? "", 240) };
    }),
    told: told.map((t, i) => ({ id: `t${i + 1}`, date: t.date, headline: t.headline, ...(t.summary ? { summary: t.summary } : {}) })),
  });
  try {
    const prompt = await activePrompt("news_dedup");
    const judgement = await extractJson<Judgement>(prompt.text, payload, {
      schema: REPEAT_SCHEMA, maxOutputTokens: 6000, reasoningEffort: "medium",
      onUsage: (input, output) => { usage.tokensIn += input; usage.tokensOut += output; },
    });
    const verdict = readJudgement(items.map((item) => ({ id: item.extraction.id })), told, judgement);
    console.log(`[Phase 5] Section 1 repeat judge: ${verdict.repeats.size} repeats left out, ${verdict.updates.size} updates, ${verdict.groups.size} items in same-story groups`);
    return verdict;
  } catch (err) {
    console.error(`[Phase 5] Section 1 repeat judge failed, every item goes to synthesis: ${errMessage(err)}`);
    return null;
  }
}

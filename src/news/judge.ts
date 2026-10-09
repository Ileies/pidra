/**
 * The repeat judge: one model call per run that compares the morning's news stories with what the
 * reader was already told (`pipeline/told.ts`) and with each other, which word overlap cannot do
 * for a story re-worded or found at another outlet. It only records verdicts on `validation`, the
 * same fields the deterministic checks use, so the gate and `/[date]/triage` need nothing new.
 * Fails open: without a verdict a story is kept, as before the judge existed.
 */
import { activePrompt } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";
import { errMessage, squash } from "../util/text";
import { heldBack, keepOrder, type Candidate, type ReportedStory } from "./validate";

const SCHEMA = {
  name: "news_repeat_judgement",
  schema: {
    type: "object", additionalProperties: false, required: ["repeats", "groups"],
    properties: {
      repeats: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["id", "told_id", "adds_new_fact"],
          properties: { id: { type: "string" }, told_id: { type: "string" }, adds_new_fact: { type: "boolean" } },
        },
      },
      groups: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["ids"],
          properties: { ids: { type: "array", items: { type: "string" } } },
        },
      },
    },
  },
};

export interface Judgement {
  repeats: { id: string; told_id: string; adds_new_fact: boolean }[];
  groups: { ids: string[] }[];
}

export interface JudgeUsage { aiCalls: number; tokensIn: number; tokensOut: number }

/** Stories still in play: a story the deterministic checks already hold back needs no verdict. */
const inPlay = (c: Candidate) => !heldBack(c.validation);

/**
 * Applies a verdict in place and returns how many stories it held back. A repeat is held unless it
 * adds a new fact; of a group, the copy `keepOrder` ranks first is kept and the rest are duplicates.
 * Ids the model invented are ignored, and a stored story is never re-judged.
 */
export function applyJudgement(candidates: Candidate[], told: ReportedStory[], judgement: Judgement): number {
  const pool = candidates.filter(inPlay);
  const byId = new Map(pool.map((c, i) => [`c${i + 1}`, c]));
  const toldById = new Map(told.map((t, i) => [`t${i + 1}`, t]));
  let held = 0;

  for (const { id, told_id, adds_new_fact } of judgement.repeats ?? []) {
    const candidate = byId.get(id);
    const prior = toldById.get(told_id);
    if (!candidate || !prior || candidate.stored || adds_new_fact || !inPlay(candidate)) continue;
    candidate.validation.alreadyReported = { date: prior.date, headline: prior.headline };
    held++;
  }

  for (const { ids } of judgement.groups ?? []) {
    const members = [...new Set(ids)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).filter(inPlay);
    if (members.length < 2) continue;
    const [keeper, ...rest] = keepOrder(members);
    for (const copy of rest) {
      if (copy.stored) continue;
      copy.validation.duplicateOf = { desk: keeper.desk, headline: keeper.story.headline };
      held++;
    }
  }
  return held;
}

/** The ids are positions in `pool`, so `applyJudgement` must be given the same candidates in the same order. */
function payload(pool: Candidate[], told: ReportedStory[]): string {
  return JSON.stringify({
    candidates: pool.map((c, i) => ({
      id: `c${i + 1}`, desk: c.desk, headline: c.story.headline, summary: squash(c.story.summary, 240), ...(c.stored ? { stored: true } : {}),
    })),
    told: told.map((t, i) => ({ id: `t${i + 1}`, date: t.date, headline: t.headline, ...(t.summary ? { summary: t.summary } : {}) })),
  });
}

/**
 * Judges the run's candidates against `told`, records the verdicts and returns how many stories it
 * held back. Makes no call when no fresh story is in play, or when there is nothing to compare it
 * with. Never throws.
 */
export async function judgeRepeats(candidates: Candidate[], told: ReportedStory[], usage: JudgeUsage): Promise<number> {
  const pool = candidates.filter(inPlay);
  if (!pool.some((c) => !c.stored) || (told.length === 0 && pool.length < 2)) return 0;
  try {
    const prompt = await activePrompt("news_dedup");
    usage.aiCalls++;
    const judgement = await extractJson<Judgement>(prompt.text, payload(pool, told), {
      schema: SCHEMA, maxOutputTokens: 6000, reasoningEffort: "medium",
      onUsage: (input, output) => { usage.tokensIn += input; usage.tokensOut += output; },
    });
    const held = applyJudgement(candidates, told, judgement);
    console.log(`[News] Repeat judge held back ${held} of ${pool.length} stories`);
    return held;
  } catch (err) {
    console.error(`[News] Repeat judge failed, the stories stand as the checks left them: ${errMessage(err)}`);
    return 0;
  }
}

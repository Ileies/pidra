/**
 * P2 shadow task: Jev scores each eligible desk story's public impact and the answer goes to the
 * ledger only. Nothing here reads back into the stories, the gate or the report. Public story
 * fields only (never notes, mail or the harvested document). Off unless `JEV_MODE_NEWS_IMPACT` is set.
 */
import { activeJevRubric } from "../ai/jev-rubrics";
import { modeFor, runJevDecision } from "../ai/jev";
import { recordJevDecision } from "../ai/jev-ledger";
import { currentRunId } from "../util/trace";
import { errMessage } from "../util/text";
import type { Fetch } from "@typesafe-ai/sdk";
import { heldBack, type Candidate, type DeskStory } from "./validate";

/** The public fields of one story, the whole of what reaches Jev. */
export function impactState(story: DeskStory) {
  return { headline: story.headline, summary: story.summary, context: story.context, region: story.region, topic: story.topic, happened_at: story.happened_at };
}

/** Stable across retries of one run: desk plus a hash of the headline. */
export function storyKey(desk: string, story: DeskStory): string {
  const hash = new Bun.CryptoHasher("sha256").update(story.headline.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `${desk}:${hash}`;
}

/**
 * Scores the stories that passed the deterministic checks and were not stored by an earlier run.
 * Never throws: a failed call is a ledger row, a failed ledger write is a warning. Returns the number
 * of decisions recorded. `transport` is for synthetic tests only.
 */
export async function shadowNewsImpact(candidates: Candidate[], transport?: { fetch?: Fetch }): Promise<number> {
  const runId = currentRunId();
  if (!runId) return 0;
  try {
    if (modeFor("news_impact") === "off") return 0;
    const eligible = candidates.filter((c) => !c.stored && !heldBack(c.validation));
    if (eligible.length === 0) return 0;
    const rubric = await activeJevRubric("jev_news_impact");
    const results = await Promise.all(eligible.map(async ({ desk, story }) => {
      const state = impactState(story);
      const result = await runJevDecision({
        task: "news_impact",
        rubricVersion: rubric.rubricVersion,
        state,
        ...(transport?.fetch ? { fetch: transport.fetch } : {}),
        questions: { impact: { type: "score", instructions: rubric.question, criteria: rubric.criteria as [string, string, ...string[]] } },
      });
      return recordJevDecision(result, { runId, subjectKey: storyKey(desk, story), state });
    }));
    return results.filter(Boolean).length;
  } catch (error) {
    console.warn(`[News] Jev shadow scoring failed: ${errMessage(error)}`);
    return 0;
  }
}

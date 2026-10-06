/**
 * P2 shadow tasks: Jev scores each eligible desk story's public impact and its novelty against
 * recently reported headlines, and the answers go to the ledger only. Nothing here reads back into
 * the stories, the gate or the report. Public story fields only (never notes, mail or the harvested
 * document). Each task is off unless its `JEV_MODE_NEWS_<TASK>` variable is set.
 */
import { activeJevRubric, type JevRubricSection } from "../ai/jev-rubrics";
import { modeFor, runJevDecision, type JevTask } from "../ai/jev";
import { recordJevDecision } from "../ai/jev-ledger";
import { currentRunId } from "../util/trace";
import { errMessage } from "../util/text";
import type { EntryType, Fetch } from "@typesafe-ai/sdk";
import { heldBack, type Candidate, type DeskStory, type ReportedStory } from "./validate";

/** Most recent prior headlines shown with a novelty question: a small set, not the whole archive. */
export const PRIOR_HEADLINE_LIMIT = 20;

/** The public fields of one story, the whole of what reaches Jev for the impact question. */
export function impactState(story: DeskStory) {
  return { headline: story.headline, summary: story.summary, context: story.context, region: story.region, topic: story.topic, happened_at: story.happened_at };
}

/** The impact fields plus the newest already-reported headlines, for the novelty question. */
export function noveltyState(story: DeskStory, reported: ReportedStory[]) {
  const prior = [...reported].sort((a, b) => b.date.localeCompare(a.date)).slice(0, PRIOR_HEADLINE_LIMIT);
  return { ...impactState(story), prior_headlines: prior.map((r) => ({ date: r.date, headline: r.headline })) };
}

/** Stable across retries of one run: desk plus a hash of the headline. */
export function storyKey(desk: string, story: DeskStory): string {
  const hash = new Bun.CryptoHasher("sha256").update(story.headline.trim().toLowerCase()).digest("hex").slice(0, 16);
  return `${desk}:${hash}`;
}

interface Transport { fetch?: Fetch }

async function shadowTask(
  task: JevTask & ("news_impact" | "news_novelty"),
  section: JevRubricSection,
  question: string,
  eligible: Candidate[],
  stateOf: (story: DeskStory) => EntryType,
  runId: string,
  transport?: Transport,
): Promise<number> {
  if (modeFor(task) === "off" || eligible.length === 0) return 0;
  const rubric = await activeJevRubric(section);
  const results = await Promise.all(eligible.map(async ({ desk, story }) => {
    const state = stateOf(story);
    const result = await runJevDecision({
      task,
      rubricVersion: rubric.rubricVersion,
      state,
      ...(transport?.fetch ? { fetch: transport.fetch } : {}),
      questions: { [question]: { type: "score", instructions: rubric.question, criteria: rubric.criteria as [string, string, ...string[]] } },
    });
    return recordJevDecision(result, { runId, subjectKey: storyKey(desk, story), state });
  }));
  return results.filter(Boolean).length;
}

/**
 * Scores the stories that passed the deterministic checks and were not stored by an earlier run.
 * Never throws: a failed call is a ledger row, a failed ledger write is a warning. Returns the number
 * of decisions recorded. `transport` is for synthetic tests only.
 */
export async function shadowNewsJev(candidates: Candidate[], reported: ReportedStory[], transport?: Transport): Promise<number> {
  const runId = currentRunId();
  if (!runId) return 0;
  const eligible = candidates.filter((c) => !c.stored && !heldBack(c.validation));
  const run = (task: Parameters<typeof shadowTask>[0], section: JevRubricSection, question: string, stateOf: (story: DeskStory) => EntryType) =>
    shadowTask(task, section, question, eligible, stateOf, runId, transport).catch((error) => {
      console.warn(`[News] Jev shadow ${task} failed: ${errMessage(error)}`);
      return 0;
    });
  const counts = await Promise.all([
    run("news_impact", "jev_news_impact", "impact", impactState),
    run("news_novelty", "jev_news_novelty", "novelty", (story) => noveltyState(story, reported)),
  ]);
  return counts[0] + counts[1];
}

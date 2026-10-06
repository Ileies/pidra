/**
 * The news desk run: every enabled desk researches the window in parallel, each answer is checked
 * (`validate/`), and every story is stored as an extraction under one `raw_items` delivery per
 * desk - `source_type = 'web_news'`, `source_name = 'news:<desk>'` (`store.ts`).
 *
 * Stored like any other source on purpose. From there the rest of the chain applies unchanged:
 * the Phase 3 gate judges each story and records why, `/[date]/triage` shows the ones held back,
 * the report cites them with `<!--refs:-->`, and a rating lands in `feedback_events` like one on a
 * newsletter item.
 *
 * Idempotent per desk and run date, keyed on the delivery's `message_id`: a desk already stored
 * today is reused rather than paid for again, so a retry, or a manual re-run after a later step
 * failed, only runs the desks that are missing. The cost is that a re-run hours later does not see
 * news from those hours - the same trade the morning schedule makes anyway.
 */

import { errMessage } from "../util/text";
import { activePrompt } from "../ai/active-prompts";
import { DeskResearchError, researchDesk, type UsageTotals } from "./research";
import { loadLongTermContext, type LongTermContext } from "../pipeline/long-term-context";
import { span } from "../util/trace";
import { decideGate } from "../pipeline/gate";
import {
  DESKS, NEWS_SOURCE_TYPE, deskSource, enabledDesks, homeConfig, newsWindow,
  type Desk, type DeskId, type HomeConfig, type NewsWindow,
} from "./config";
import { shadowNewsJev } from "./jev-shadow";
import { lastScanEnd, loadReusedDesks, persist, priorities, recentlyReported, type DeskAnswer } from "./store";
import {
  findAlreadyReported, heldBack, isAbroad, markDuplicates, tidyStory, verifySources, withinWindow,
  type Candidate, type DeskStory, type ReportedStory,
} from "./validate";
export { toExtraction } from "./validate";

export interface DeskReport {
  desk: DeskId;
  status: "ran" | "reused" | "failed" | "unconfigured";
  /** Stories stored for this desk, whatever the gate later makes of them. */
  stories: number;
  searchCalls: number;
  /** What the desk searched for, on a desk that ran. Also stored in the delivery's raw content. */
  queries?: string[];
  error?: string;
}

export interface NewsDeskOutcome extends UsageTotals {
  window: NewsWindow | null;
  home: HomeConfig | null;
  desks: DeskReport[];
  /** In the `<source>: <message>` shape Phase 1 uses, so `step_errors` reads the same. */
  failures: { source: string; error: string }[];
  /** A dry run's stories with their verdicts, in place of storing them. */
  preview?: { desk: DeskId; story: DeskStory; validation: Candidate["validation"] }[];
}

export const EMPTY_NEWS_DESK: NewsDeskOutcome = {
  window: null,
  home: null,
  desks: [],
  failures: [],
  aiCalls: 0,
  searchCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
};

function addUsage(outcome: NewsDeskOutcome, usage: UsageTotals) {
  outcome.aiCalls += usage.aiCalls;
  outcome.searchCalls += usage.searchCalls;
  outcome.tokensIn += usage.tokensIn;
  outcome.tokensOut += usage.tokensOut;
}

interface DeskInputs {
  window: NewsWindow;
  home: HomeConfig | null;
  reported: ReportedStory[];
  interests: string;
  priorities: string[];
  /** Whether the beat desk runs today, which decides whether the fields desk covers priority one. */
  beatDesk: boolean;
}

/**
 * Each desk sees only what its mandate needs. The world desk is deliberately given nothing about
 * the reader, and no desk is given the personal half of the context document: these calls have a
 * search engine attached, and what reaches them can end up in a query.
 */
function deskPayload(desk: Desk, inputs: DeskInputs): Record<string, unknown> {
  const base = {
    window: inputs.window,
    already_reported: inputs.reported.map((r) => ({ date: r.date, headline: r.headline })),
  };
  const home = inputs.home;

  switch (desk.id) {
    case "world":
      return base;
    case "home":
      return {
        ...base,
        home: home && {
          city: home.city,
          region: home.region,
          country: home.countryName,
          also_countries: home.also.map((c) => c.name),
        },
      };
    case "beat":
      return { ...base, interests: inputs.interests || null, priorities: inputs.priorities };
    case "field":
      return { ...base, interests: inputs.interests || null, priorities: inputs.priorities, beat_desk: inputs.beatDesk };
    case "talk":
      // reader_notes: the intel notes, so a kind of story the reader excludes (sport, celebrity)
      // is left out here too - this desk used to sweep sport regardless.
      return { ...base, home: home ? { country: home.countryName } : null, reader_notes: inputs.priorities };
    case "serendipity":
      return { ...base, avoid: inputs.priorities };
  }
}

async function research(desk: Desk, inputs: DeskInputs): Promise<DeskAnswer> {
  const prompt = await activePrompt(desk.section);
  const started = Date.now();
  const result = await researchDesk(desk, prompt.text, deskPayload(desk, inputs), inputs.window, inputs.home);
  return {
    ...result,
    desk,
    stories: result.stories.map(tidyStory),
    durationMs: Date.now() - started,
    prompt: { section: prompt.section, version: prompt.version },
  };
}

/** One desk's stories with the checks run against them. */
function buildCandidates(answer: DeskAnswer, inputs: DeskInputs): Candidate[] {
  const { desk } = answer;
  // Searched but reported no URLs: the check cannot be made. Never searched: nothing is sourced.
  const consulted = answer.searchCalls > 0 && answer.sources.length === 0 ? null : answer.sources;
  return answer.stories.map((story): Candidate => ({
    desk: desk.id,
    deskOrder: DESKS.indexOf(desk),
    story,
    validation: {
      ...verifySources(story, consulted),
      inWindow: withinWindow(story.happened_at, inputs.window),
      duplicateOf: null,
      alreadyReported: findAlreadyReported(story, inputs.reported),
      abroad: desk.id === "home" && isAbroad(story.region, inputs.home),
    },
    stored: false,
  }));
}

export interface RunOptions {
  now?: Date;
  /** Research and check, but store nothing: for tuning the desk prompts without touching a run. */
  dryRun?: boolean;
  /** Where the long-term context comes from; the pipeline passes a loader shared with Phase 3. */
  loadContext?: () => Promise<LongTermContext>;
}

/**
 * Runs every enabled desk for `runDate`. Tolerant per desk, the way Phase 1 is per source: a desk
 * that fails is recorded and the rest carry on. Failed searches are not automatically retried by
 * the pipeline, since another whole attempt could spend the same day's Brave budget twice.
 */
export async function runNewsDesk(
  runDate: string,
  { now = new Date(), dryRun = false, loadContext = loadLongTermContext }: RunOptions = {},
): Promise<NewsDeskOutcome> {
  const plan = enabledDesks();
  const home = homeConfig();
  const outcome: NewsDeskOutcome = { ...EMPTY_NEWS_DESK, home, desks: [], failures: [] };

  for (const { desk, reason } of plan.unconfigured) {
    outcome.desks.push({ desk: desk.id, status: "unconfigured", stories: 0, searchCalls: 0, error: reason });
    outcome.failures.push({ source: deskSource(desk.id), error: reason });
  }
  if (plan.desks.length === 0) {
    console.log(`[News] No desk enabled${plan.unconfigured.length ? " that is configured" : ""} - skipping`);
    return outcome;
  }

  const earlier = await loadReusedDesks(plan.desks, runDate);
  const window = earlier.window ?? newsWindow(now, await lastScanEnd(runDate));
  outcome.window = window;

  const toRun = plan.desks.filter((desk) => !earlier.desks.has(desk.id));
  const reused = plan.desks.filter((desk) => earlier.desks.has(desk.id));

  const [reported, ltc, notesList] = await Promise.all([
    recentlyReported(runDate),
    toRun.some((desk) => desk.id === "field" || desk.id === "beat") ? loadContext() : Promise.resolve(null),
    priorities(runDate),
  ]);
  const inputs: DeskInputs = {
    window,
    home,
    reported,
    interests: ltc?.interestSections ?? "",
    priorities: notesList,
    beatDesk: plan.desks.some((desk) => desk.id === "beat"),
  };

  console.log(
    `[News] Window ${window.start} to ${window.end}; running ${toRun.map((d) => d.id).join(", ") || "none"}` +
    (reused.length ? `, reusing ${reused.map((d) => d.id).join(", ")} from an earlier run today` : ""),
  );

  const settled = await Promise.allSettled(toRun.map((desk) => span(`news:${desk.id}`, () => research(desk, inputs))));

  const candidates: Candidate[] = [...earlier.candidates];
  for (const desk of reused) {
    outcome.desks.push({ desk: desk.id, status: "reused", stories: earlier.counts.get(desk.id) ?? 0, searchCalls: 0 });
  }

  const answers: { answer: DeskAnswer; candidates: Candidate[] }[] = [];
  settled.forEach((result, index) => {
    const desk = toRun[index];
    if (result.status === "rejected") {
      const error = errMessage(result.reason);
      console.error(`[News] ${desk.id} failed:`, result.reason);
      outcome.failures.push({ source: deskSource(desk.id), error });
      const spent = result.reason instanceof DeskResearchError ? result.reason.usage : null;
      if (spent) addUsage(outcome, spent);
      outcome.desks.push({ desk: desk.id, status: "failed", stories: 0, searchCalls: spent?.searchCalls ?? 0, error });
      return;
    }

    addUsage(outcome, result.value);
    const own = buildCandidates(result.value, inputs);
    candidates.push(...own);
    answers.push({ answer: result.value, candidates: own });
  });

  markDuplicates(candidates, (c) => decideGate({
    sourceType: NEWS_SOURCE_TYPE,
    aiFailed: false,
    extractedJson: { validation: c.validation },
    relevanceScore: c.story.significance,
    trustScore: 1,
    sourceCount: 1,
  }).passed);

  if (dryRun) {
    outcome.preview = answers.flatMap(({ answer, candidates: own }) =>
      own.map((c) => ({ desk: answer.desk.id, story: c.story, validation: c.validation })));
  }

  for (const { answer, candidates: own } of answers) {
    let stored: number;
    try {
      stored = dryRun ? own.length : await persist(answer, own, runDate, window);
    } catch (error) {
      const detail = errMessage(error);
      outcome.failures.push({ source: deskSource(answer.desk.id), error: detail });
      outcome.desks.push({ desk: answer.desk.id, status: "failed", stories: 0, searchCalls: answer.searchCalls, queries: answer.queries, error: detail });
      continue;
    }
    const held = own.filter((c) => heldBack(c.validation)).length;
    outcome.desks.push({ desk: answer.desk.id, status: "ran", stories: stored, searchCalls: answer.searchCalls, queries: answer.queries });
    console.log(
      `[News] ${answer.desk.id}: ${stored} stories (${held} held back by the checks), ` +
      `${answer.searchCalls} search calls, ${answer.queries.length} queries, ${Math.round(answer.durationMs / 1000)}s`,
    );
  }

  if (!dryRun) await span("news:jev-shadow", () => shadowNewsJev(candidates, inputs.reported));

  // In DESKS order, so logs and anything that lists the desks read the same every day.
  outcome.desks.sort((a, b) => DESKS.findIndex((d) => d.id === a.desk) - DESKS.findIndex((d) => d.id === b.desk));
  return outcome;
}

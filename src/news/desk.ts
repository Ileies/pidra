/**
 * The news desk run: every enabled desk researches the window in parallel, each answer is checked
 * (`validate.ts`), and every story is stored as an extraction under one `raw_items` delivery per
 * desk - `source_type = 'web_news'`, `source_name = 'news:<desk>'`.
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

import { and, eq, gte, inArray, isNull, lt, max, or } from "drizzle-orm";
import { db, extractions, notes, rawItems } from "../db";
import { activePrompt } from "../ai/active-prompts";
import { RESEARCH_MODEL, researchJson } from "../ai/openai";
import { loadLongTermContext } from "../pipeline/long-term-context";
import { decideGate } from "../pipeline/gate";
import {
  DESKS, NEWS_SOURCE_TYPE, deskMessageId, deskSource, enabledDesks, homeConfig, newsWindow,
  type Desk, type DeskId, type HomeConfig, type NewsWindow,
} from "./desks";
import {
  findAlreadyReported, heldBack, isAbroad, markDuplicates, tidyStory, verifySources, withinWindow,
  type Candidate, type DeskStory, type NewsExtraction, type ReportedStory,
} from "./validate";

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

export interface NewsDeskOutcome {
  window: NewsWindow | null;
  home: HomeConfig | null;
  desks: DeskReport[];
  /** In the `<source>: <message>` shape Phase 1 uses, so `step_errors` reads the same. */
  failures: { source: string; error: string }[];
  /** Calls this run made. A reused desk costs nothing. */
  aiCalls: number;
  searchCalls: number;
  tokensIn: number;
  tokensOut: number;
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

const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline", "summary", "context", "significance", "status", "confidence",
    "region", "topic", "happened_at", "entities", "sources",
  ],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    context: { type: "string" },
    // An enum rather than a bare integer: unconstrained, the first probe invented a 0-100 scale.
    significance: { type: "integer", enum: [1, 2, 3, 4, 5] },
    status: { type: "string", enum: ["new", "update"] },
    confidence: { type: "string", enum: ["confirmed", "reported", "unconfirmed"] },
    region: { type: "string" },
    topic: { type: "string" },
    happened_at: { type: "string" },
    entities: { type: "array", items: { type: "string" } },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["publisher", "title", "url"],
        properties: { publisher: { type: "string" }, title: { type: "string" }, url: { type: "string" } },
      },
    },
  },
};

const DESK_SCHEMA = {
  name: "news_desk",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["stories"],
    properties: { stories: { type: "array", items: STORY_SCHEMA } },
  },
};

/** How many days of what the reader was already told each desk is shown, and dedup compares against. */
const REPORTED_LOOKBACK_DAYS = 3;

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
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

const EFFORTS = new Set(["low", "medium", "high"]);

/** The desk's own effort (see `Desk.effort`), unless `NEWS_REASONING_EFFORT` sets one for all. */
function reasoningEffort(desk: Desk): "low" | "medium" | "high" {
  const value = process.env.NEWS_REASONING_EFFORT?.trim().toLowerCase();
  return value && EFFORTS.has(value) ? (value as "low" | "medium" | "high") : desk.effort;
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
      return { ...base, home: home ? { country: home.countryName } : null };
    case "serendipity":
      return { ...base, avoid: inputs.priorities };
  }
}

function userLocation(desk: Desk, home: HomeConfig | null) {
  if (!desk.locality || !home) return undefined;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return desk.locality === "city"
    ? { city: home.city, region: home.region, country: home.country, timezone }
    : { country: home.country, timezone };
}

interface DeskAnswer {
  desk: Desk;
  stories: DeskStory[];
  queries: string[];
  sources: string[];
  searchCalls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  prompt: { section: string; version: number | null };
}

async function research(desk: Desk, inputs: DeskInputs): Promise<DeskAnswer> {
  const prompt = await activePrompt(desk.section);
  const started = Date.now();
  const result = await researchJson<{ stories: DeskStory[] }>(
    prompt.text,
    JSON.stringify(deskPayload(desk, inputs)),
    { schema: DESK_SCHEMA, userLocation: userLocation(desk, inputs.home), reasoningEffort: reasoningEffort(desk) },
  );
  return {
    desk,
    stories: (result.data.stories ?? []).map(tidyStory),
    queries: result.queries,
    sources: result.sources,
    searchCalls: result.searchCalls,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    durationMs: Date.now() - started,
    prompt: { section: prompt.section, version: prompt.version },
  };
}

/**
 * The delivery's `raw_content`: a header block the dashboard's `parseTitle` already reads, then
 * the whole answer, queries and consulted URLs included, so a surprising story can be traced back
 * to the searches that produced it.
 */
function deliveryContent(answer: DeskAnswer, window: NewsWindow): string {
  const header = [
    `Title: ${answer.desk.label}`,
    `Source: ${deskSource(answer.desk.id)}`,
    `Window: ${window.start} to ${window.end}`,
  ].join("\n");
  const body = JSON.stringify({
    desk: answer.desk.id,
    model: RESEARCH_MODEL,
    prompt: answer.prompt,
    window,
    durationMs: answer.durationMs,
    searchCalls: answer.searchCalls,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
    queries: answer.queries,
    consulted: answer.sources,
    stories: answer.stories,
  });
  return `${header}\n\n${body}`;
}

/** The window an earlier run of the same day recorded, so every desk of one date shares one. */
function storedWindow(rawContent: string | null): NewsWindow | null {
  if (!rawContent) return null;
  try {
    const body = JSON.parse(rawContent.slice(rawContent.indexOf("\n\n") + 2)) as { window?: NewsWindow };
    return body.window?.start && body.window?.end ? body.window : null;
  } catch {
    return null;
  }
}

async function lastScanEnd(runDate: string): Promise<Date | null> {
  const [row] = await db
    .select({ end: max(rawItems.receivedAt) })
    .from(rawItems)
    .where(and(eq(rawItems.sourceType, NEWS_SOURCE_TYPE), lt(rawItems.runDate, runDate)));
  return row?.end ? new Date(row.end) : null;
}

/** What the reader actually saw on the last few days: cited in a report, not merely researched. */
async function recentlyReported(runDate: string): Promise<ReportedStory[]> {
  const rows = await db
    .select({ runDate: extractions.runDate, json: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(
      eq(rawItems.sourceType, NEWS_SOURCE_TYPE),
      eq(extractions.includedInReport, true),
      gte(extractions.runDate, daysBefore(runDate, REPORTED_LOOKBACK_DAYS)),
      lt(extractions.runDate, runDate),
    ));

  return rows.flatMap((row) => {
    const json = row.json as Partial<NewsExtraction> | null;
    if (!json?.headline) return [];
    return [{ date: row.runDate, headline: json.headline, urls: (json.sources ?? []).map((s) => s.url) }];
  });
}

/** The reader's own ranking of what they follow, from the intel notes. Expired ones are skipped. */
async function priorities(runDate: string): Promise<string[]> {
  const rows = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(
      eq(notes.scope, "intel"),
      isNull(notes.deletedAt),
      or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)),
    ));
  return rows.map((r) => r.content);
}

/** A checked story as its extraction row stores it. */
export function toExtraction(desk: DeskId, story: DeskStory, validation: NewsExtraction["validation"]): NewsExtraction {
  return {
    desk,
    headline: story.headline,
    key_claim: story.summary,
    context: story.context,
    significance: story.significance,
    status: story.status,
    confidence: story.confidence,
    region: story.region,
    topic: story.topic,
    happened_at: story.happened_at,
    entities: story.entities,
    sources: story.sources,
    validation,
  };
}

function storyFromStored(json: NewsExtraction): DeskStory {
  return {
    headline: json.headline,
    summary: json.key_claim,
    context: json.context,
    significance: json.significance,
    status: json.status,
    confidence: json.confidence,
    region: json.region,
    topic: json.topic,
    happened_at: json.happened_at,
    entities: json.entities ?? [],
    sources: json.sources ?? [],
  };
}

async function persist(answer: DeskAnswer, candidates: Candidate[], runDate: string, window: NewsWindow): Promise<number> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .insert(rawItems)
      .values({
        runDate,
        sourceType: NEWS_SOURCE_TYPE,
        sourceName: deskSource(answer.desk.id),
        messageId: deskMessageId(runDate, answer.desk.id),
        rawContent: deliveryContent(answer, window),
        receivedAt: window.end,
      })
      .onConflictDoNothing({ target: rawItems.messageId })
      .returning({ id: rawItems.id });

    // A concurrent run stored this desk first. Its stories are the record; ours are dropped whole
    // rather than interleaved with them.
    if (!delivery) return 0;

    for (const { story, validation } of candidates) {
      await tx.insert(extractions).values({
        rawItemId: delivery.id,
        runDate,
        extractedJson: toExtraction(answer.desk.id, story, validation),
        // The desk's significance, on its own scale. Phase 3 overwrites effective relevance with
        // the gate's figure, which for a news story is the same number: no trust score applies.
        relevanceScore: story.significance,
        effectiveRelevance: story.significance,
        novelty: story.status === "update" ? "continuation" : "new",
        includedInReport: false,
        aiFailed: false,
      });
    }
    return candidates.length;
  });
}

export interface RunOptions {
  now?: Date;
  /** Research and check, but store nothing: for tuning the desk prompts without touching a run. */
  dryRun?: boolean;
}

/**
 * Runs every enabled desk for `runDate`. Tolerant per desk, the way Phase 1 is per source: a desk
 * that fails is recorded and the rest carry on. It throws only when every desk it tried failed and
 * nothing was stored earlier, which is an outage rather than one bad answer, so that `withRetry`
 * gets another go at it.
 */
export async function runNewsDesk(runDate: string, { now = new Date(), dryRun = false }: RunOptions = {}): Promise<NewsDeskOutcome> {
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

  const existing = await db
    .select({ id: rawItems.id, sourceName: rawItems.sourceName, rawContent: rawItems.rawContent })
    .from(rawItems)
    .where(inArray(rawItems.messageId, plan.desks.map((desk) => deskMessageId(runDate, desk.id))));
  const reusedIds = new Map(existing.map((row) => [row.sourceName, row]));

  const window = existing.map((row) => storedWindow(row.rawContent)).find((w) => w !== null)
    ?? newsWindow(now, await lastScanEnd(runDate));
  outcome.window = window;

  const toRun = plan.desks.filter((desk) => !reusedIds.has(deskSource(desk.id)));
  const reused = plan.desks.filter((desk) => reusedIds.has(deskSource(desk.id)));

  const [reported, ltc, notesList] = await Promise.all([
    recentlyReported(runDate),
    toRun.some((desk) => desk.id === "field" || desk.id === "beat") ? loadLongTermContext() : Promise.resolve(null),
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

  const settled = await Promise.allSettled(toRun.map((desk) => research(desk, inputs)));

  // Everything the day already holds takes part in the duplicate check, stored stories included,
  // so a desk re-run after a failure cannot repeat a story another desk stored this morning.
  const candidates: Candidate[] = [];
  const reusedRows = reused.length
    ? await db
        .select({ json: extractions.extractedJson, rawItemId: extractions.rawItemId })
        .from(extractions)
        .where(inArray(extractions.rawItemId, reused.map((desk) => reusedIds.get(deskSource(desk.id))!.id)))
    : [];
  for (const row of reusedRows) {
    const json = row.json as NewsExtraction | null;
    if (!json?.headline) continue;
    candidates.push({
      desk: json.desk,
      deskOrder: DESKS.findIndex((d) => d.id === json.desk),
      story: storyFromStored(json),
      validation: json.validation,
      stored: true,
    });
  }
  for (const desk of reused) {
    const count = reusedRows.filter((row) => row.rawItemId === reusedIds.get(deskSource(desk.id))!.id).length;
    outcome.desks.push({ desk: desk.id, status: "reused", stories: count, searchCalls: 0 });
  }

  const answers: { answer: DeskAnswer; candidates: Candidate[] }[] = [];
  settled.forEach((result, index) => {
    const desk = toRun[index];
    if (result.status === "rejected") {
      console.error(`[News] ${desk.id} failed:`, result.reason);
      outcome.failures.push({ source: deskSource(desk.id), error: message(result.reason) });
      outcome.desks.push({ desk: desk.id, status: "failed", stories: 0, searchCalls: 0, error: message(result.reason) });
      return;
    }

    const answer = result.value;
    outcome.aiCalls += 1;
    outcome.searchCalls += answer.searchCalls;
    outcome.tokensIn += answer.tokensIn;
    outcome.tokensOut += answer.tokensOut;

    // Searched but reported no URLs: the check cannot be made. Never searched: nothing is sourced.
    const consulted = answer.searchCalls > 0 && answer.sources.length === 0 ? null : answer.sources;
    const own = answer.stories.map((story): Candidate => ({
      desk: desk.id,
      deskOrder: DESKS.indexOf(desk),
      story,
      validation: {
        ...verifySources(story, consulted),
        inWindow: withinWindow(story.happened_at, window),
        duplicateOf: null,
        alreadyReported: findAlreadyReported(story, reported),
        abroad: desk.id === "home" && isAbroad(story.region, home),
      },
      stored: false,
    }));
    candidates.push(...own);
    answers.push({ answer, candidates: own });
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
    const stored = dryRun ? own.length : await persist(answer, own, runDate, window);
    const held = own.filter((c) => heldBack(c.validation)).length;
    outcome.desks.push({ desk: answer.desk.id, status: "ran", stories: stored, searchCalls: answer.searchCalls, queries: answer.queries });
    console.log(
      `[News] ${answer.desk.id}: ${stored} stories (${held} held back by the checks), ` +
      `${answer.searchCalls} search calls, ${answer.queries.length} queries, ${Math.round(answer.durationMs / 1000)}s`,
    );
  }

  if (answers.length === 0 && reused.length === 0) {
    const failed = outcome.desks.filter((d) => d.status === "failed");
    throw new Error(`every news desk failed - ${failed.map((d) => `${d.desk}: ${d.error}`).join("; ")}`);
  }

  // In DESKS order, so logs and anything that lists the desks read the same every day.
  outcome.desks.sort((a, b) => DESKS.findIndex((d) => d.id === a.desk) - DESKS.findIndex((d) => d.id === b.desk));
  return outcome;
}

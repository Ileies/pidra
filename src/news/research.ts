/**
 * Brave-backed research for one news desk, called by `run.ts`. Search calls are budgeted here
 * (`SEARCH_BUDGET` in config.ts), not by the model: plan queries (model) -> Brave news search ->
 * plan follow-ups -> Brave context search -> final structured answer. Writes nothing to the DB;
 * spend is counted in `Usage` and every Brave request also reserves quota in `src/search/brave.ts`.
 */

import { errMessage, squash } from "../util/text";
import { extractJson, EXTRACTION_MODEL } from "../ai/openai";
import { NEWS_FINAL_INSTRUCTIONS, newsQueryPlanPrompt } from "../ai/prompts/news-desks";
import { braveContext, braveSearch, type BraveResult } from "../search/brave";
import { resolveStorySources, type CitedStory, type DeskStory } from "./validate";
import { SEARCH_BUDGET, type Desk, type HomeConfig, type NewsWindow } from "./config";

const QUERY_SCHEMA = {
  name: "news_search_queries",
  schema: {
    type: "object", additionalProperties: false, required: ["queries"],
    properties: { queries: { type: "array", items: { type: "string" } } },
  },
};

const STORY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "summary", "context", "significance", "status", "confidence", "region", "topic", "happened_at", "entities", "sources"],
  properties: {
    headline: { type: "string" }, summary: { type: "string" }, context: { type: "string" },
    significance: { type: "integer", enum: [1, 2, 3, 4, 5] },
    status: { type: "string", enum: ["new", "update"] },
    confidence: { type: "string", enum: ["confirmed", "reported", "unconfirmed"] },
    region: { type: "string" }, topic: { type: "string" }, happened_at: { type: "string" },
    entities: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "publisher"], properties: { id: { type: "string" }, publisher: { type: "string" } } } },
  },
};

const DESK_SCHEMA = {
  name: "news_desk",
  schema: { type: "object", additionalProperties: false, required: ["stories"], properties: { stories: { type: "array", items: STORY_SCHEMA } } },
};

export interface SearchEvidence {
  query: string;
  results: BraveResult[];
  kind: "news" | "context";
}

export interface UsageTotals {
  aiCalls: number;
  searchCalls: number;
  tokensIn: number;
  tokensOut: number;
}

/** What one desk's research spent, counted as it goes so a failed desk still reports its cost. */
export class Usage implements UsageTotals {
  aiCalls = 0;
  searchCalls = 0;
  tokensIn = 0;
  tokensOut = 0;

  /** Pass as `onUsage` to `extractJson`. */
  readonly onUsage = (input: number, output: number) => {
    this.tokensIn += input;
    this.tokensOut += output;
  };

  /** Pass as `onAttempt` to a Brave call: every request, a retry included, spends quota. */
  readonly onSearch = () => { this.searchCalls++; };

  add(other: UsageTotals) {
    this.aiCalls += other.aiCalls;
    this.searchCalls += other.searchCalls;
    this.tokensIn += other.tokensIn;
    this.tokensOut += other.tokensOut;
  }

  totals(): UsageTotals {
    return { aiCalls: this.aiCalls, searchCalls: this.searchCalls, tokensIn: this.tokensIn, tokensOut: this.tokensOut };
  }
}

export interface ResearchAnswer extends UsageTotals {
  stories: DeskStory[];
  queries: string[];
  sources: string[];
  evidence: SearchEvidence[];
  model: string;
}

export class DeskResearchError extends Error {
  constructor(cause: unknown, readonly usage: UsageTotals) {
    super(errMessage(cause), { cause });
  }
}

interface ResearchContext {
  desk: Desk;
  prompt: string;
  payload: Record<string, unknown>;
  window: NewsWindow;
  usage: Usage;
}

// Used when the model proposes too few usable queries. Reader-derived text is only included when it
// passes `safeTopic`, since whatever reaches a query leaves the machine (see deskPayload in run.ts).
function fallbackQueries(desk: Desk, payload: Record<string, unknown>): string[] {
  const home = payload.home as { city?: string; country?: string; also_countries?: string[] } | undefined;
  const place = [home?.city, home?.country].filter(Boolean).join(" ") || "local";
  const safeTopic = (value: string | undefined, fallback: string) =>
    value && value.length <= 60 && !/@|\b(?:I|my|me|our|we|email|address)\b/i.test(value) ? value : fallback;
  const priorities = payload.priorities as string[] | undefined;
  const first = safeTopic(priorities?.[0], "technology");
  const other = (priorities?.slice(1).map((p) => safeTopic(p, "")).filter(Boolean).slice(0, 2).join(" ")) || "science startups policy";
  const terms: Record<Desk["id"], string[]> = {
    world: ["world breaking news", "world politics conflict", "global economy markets", "international disasters weather", "Asia geopolitics", "Europe politics", "Americas politics"],
    home: [`${place} breaking news`, `${place} politics`, `${place} local news`, `${home?.country ?? place} national news`, `${place} transport weather`, `${home?.also_countries?.join(" ") || place} top news`],
    beat: [`${first} latest news`, `${first} releases launches`, `${first} leading companies`, `${first} regulation policy`, `${first} funding acquisitions`, `${first} research breakthrough`, `${first} security incident`],
    field: [`${other} latest news`, `${other} major companies`, `${other} regulation`, `${other} research`],
    talk: ["trending culture entertainment", `${home?.country ?? "world"} talked about today`, "viral stories", "film music entertainment"],
    serendipity: ["unusual surprising news", "remarkable human animal discovery", "strange cultural discovery record"],
  };
  return terms[desk.id];
}

// Sanitises the model's queries (drops first-person/email wording, URLs, operators; `site:` only for
// beat/field), dedups against `prior`, then tops up from `fallback`. Throws if `count` cannot be filled.
function completeQueries(proposed: string[], count: number, prior: string[], fallback: string[], allowSite: boolean): string[] {
  const seen = new Set(prior.map((q) => q.toLowerCase()));
  const result: string[] = [];
  for (const raw of [...proposed, ...fallback]) {
    if (/@|\b(?:my|me|our|we|email|address)\b/i.test(raw)) continue;
    const unrestricted = allowSite ? raw : raw.replace(/\bsite:\S+/gi, "");
    const query = squash(unrestricted
      .replace(/https?:\/\/\S+|\b(?:after|before):\S+/gi, "")
      .replace(/[()]/g, " ").replace(/\bOR\b/gi, " "))
      .split(" ")
      .reduce((text, word) => (text.length + word.length + 1 <= 110 ? `${text} ${word}`.trim() : text), "");
    if (query.length < 4 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    result.push(query);
    if (result.length === count) return result;
  }
  throw new Error(`Could not fill ${count} distinct Brave queries`);
}

async function planQueries(
  { desk, prompt, payload, window, usage }: ResearchContext,
  count: number, prior: string[], evidence: SearchEvidence[],
): Promise<string[]> {
  const instructions = newsQueryPlanPrompt({
    deskId: desk.id,
    count,
    total: SEARCH_BUDGET[desk.id].reduce((sum, calls) => sum + calls, 0),
    followUp: prior.length > 0,
    mandate: prompt,
  });
  const input = JSON.stringify({ desk_input: payload, window, prior_queries: prior, first_results: evidence.map((search) => ({ query: search.query, results: search.results.slice(0, 8).map(({ title, description, age }) => ({ title, description, age })) })) });
  usage.aiCalls++;
  const answer = await extractJson<{ queries: string[] }>(instructions, input, { schema: QUERY_SCHEMA, maxOutputTokens: 4000, reasoningEffort: "medium", onUsage: usage.onUsage });
  return completeQueries(answer.queries ?? [], count, prior, fallbackQueries(desk, payload), desk.id === "beat" || desk.id === "field");
}

function freshness(window: NewsWindow): string {
  // Brave's `pd` uses a rolling 24 hours, which loses stories after a missed morning run.
  // A calendar range is intentionally broad; the story's event date is checked separately.
  return `${window.start.slice(0, 10)}to${window.end.slice(0, 10)}`;
}

async function searchRound(
  { window, usage }: ResearchContext, queries: string[], country: string | undefined, kind: SearchEvidence["kind"],
): Promise<SearchEvidence[]> {
  return Promise.all(queries.map(async (query) => {
    return {
      query,
      kind,
      results: (kind === "news"
        ? await braveSearch(query, 20, { kind: "news", country: country ?? "ALL", freshness: freshness(window), extraSnippets: true, onAttempt: usage.onSearch })
        : await braveContext(query, { country, freshness: freshness(window), onAttempt: usage.onSearch })).results,
    };
  }));
}

export async function researchDesk(
  desk: Desk, prompt: string, payload: Record<string, unknown>, window: NewsWindow, home: HomeConfig | null,
): Promise<ResearchAnswer> {
  const usage = new Usage();
  if (!process.env.BRAVE_SEARCH_API_KEY) throw new DeskResearchError("BRAVE_SEARCH_API_KEY is not set", usage);
  const ctx: ResearchContext = { desk, prompt, payload, window, usage };
  try {
    const [firstCount, followupCount] = SEARCH_BUDGET[desk.id];
    const country = desk.locality ? home?.country : undefined;
    const first = await planQueries(ctx, firstCount, [], []);
    const firstEvidence = await searchRound(ctx, first, country, "news");
    const followup = await planQueries(ctx, followupCount, first, firstEvidence);
    const evidence = [...firstEvidence, ...await searchRound(ctx, followup, country, "context")];
    const sources = [...new Set(evidence.flatMap((search) => search.results.map((result) => result.url)))];
    if (sources.length === 0) throw new Error("Brave returned no sources for this desk");
    const displayed = evidence.map((search) => ({ ...search, results: search.results.slice(0, 12) }));
    const displayedUrls = [...new Set(displayed.flatMap((search) => search.results.map((result) => result.url)))];
    const idByUrl = new Map(displayedUrls.map((url, index) => [url, `s${index + 1}`]));
    const sourceById = new Map(displayed.flatMap((search) =>
      search.results.map((result) => [idByUrl.get(result.url)!, result] as const)));
    const finalInput = JSON.stringify({
      desk_input: payload,
      searches: displayed.map((search) => ({
        query: search.query,
        kind: search.kind,
        results: search.results.map((result) => ({
          id: idByUrl.get(result.url),
          title: result.title,
          host: URL.canParse(result.url) ? new URL(result.url).hostname : "",
          description: result.description,
          published_at: result.publishedAt,
          age: result.age,
          extra_snippets: result.extraSnippets?.slice(0, search.kind === "context" ? 5 : 2),
        })),
      })),
    });
    const override = process.env.NEWS_REASONING_EFFORT?.trim().toLowerCase();
    const effort = override === "low" || override === "medium" || override === "high" ? override : desk.effort;
    usage.aiCalls++;
    const answer = await extractJson<{ stories: CitedStory[] }>(`${prompt}\n\n${NEWS_FINAL_INSTRUCTIONS}`, finalInput, {
      schema: DESK_SCHEMA, maxOutputTokens: 9000, reasoningEffort: effort, onUsage: usage.onUsage,
    });
    return {
      stories: (answer.stories ?? []).map((story) => resolveStorySources(story, sourceById)),
      queries: [...first, ...followup], sources, evidence, ...usage.totals(), model: EXTRACTION_MODEL,
    };
  } catch (error) {
    throw new DeskResearchError(error, usage.totals());
  }
}

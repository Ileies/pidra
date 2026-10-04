/** Brave-backed research for one news desk. Search calls are budgeted here, not by the model. */

import { errMessage, squash } from "../util/text";
import { extractJson, usageTally, EXTRACTION_MODEL } from "../ai/openai";
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

export interface ResearchAnswer {
  stories: DeskStory[];
  queries: string[];
  sources: string[];
  evidence: SearchEvidence[];
  searchCalls: number;
  aiCalls: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export class DeskResearchError extends Error {
  constructor(cause: unknown, readonly searchCalls: number, readonly aiCalls: number, readonly tokensIn: number, readonly tokensOut: number) {
    super(errMessage(cause), { cause });
  }
}

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
  desk: Desk, prompt: string, payload: Record<string, unknown>, window: NewsWindow,
  count: number, prior: string[], evidence: SearchEvidence[], onUsage: (input: number, output: number) => void,
  onAiCall: () => void,
): Promise<string[]> {
  const total = SEARCH_BUDGET[desk.id].reduce((sum, calls) => sum + calls, 0);
  const instructions = `Plan exactly ${count} distinct Brave Search queries for the ${desk.id} desk. This desk has ${total} searches total across two rounds. Use the desk mandate below. Each query must be one coherent topic or event, with plain search terms, 3 to 8 words, under 100 characters. Spread queries across the mandate; do not cram unrelated themes into one query. Do not use OR lists, parentheses, after: or before: operators, URLs, or dates: the API already filters by the news window. Avoid site: restrictions except for a named organization on a professional beat. Prefer specific topics and local-language queries where useful. Do not put personal details, email addresses, or the reader's identity into a query. ${prior.length ? "These are follow-up searches: inspect the first results, cover important gaps, and verify the major developing stories." : "These are first-pass searches: sweep the desk's broad categories. Include an overview query where that helps find the day's biggest stories."} Return JSON only.\n\nDesk mandate:\n${prompt}`;
  const input = JSON.stringify({ desk_input: payload, window, prior_queries: prior, first_results: evidence.map((search) => ({ query: search.query, results: search.results.slice(0, 8).map(({ title, description, age }) => ({ title, description, age })) })) });
  onAiCall();
  const answer = await extractJson<{ queries: string[] }>(instructions, input, { schema: QUERY_SCHEMA, maxOutputTokens: 4000, reasoningEffort: "medium", onUsage });
  return completeQueries(answer.queries ?? [], count, prior, fallbackQueries(desk, payload), desk.id === "beat" || desk.id === "field");
}

function freshness(window: NewsWindow): string {
  // Brave's `pd` uses a rolling 24 hours, which loses stories after a missed morning run.
  // A calendar range is intentionally broad; the story's event date is checked separately.
  return `${window.start.slice(0, 10)}to${window.end.slice(0, 10)}`;
}

async function searchRound(queries: string[], window: NewsWindow, country: string | undefined, kind: SearchEvidence["kind"], onCall: () => void): Promise<SearchEvidence[]> {
  return Promise.all(queries.map(async (query) => {
    return {
      query,
      kind,
      results: (kind === "news"
        ? await braveSearch(query, 20, { kind: "news", country: country ?? "ALL", freshness: freshness(window), extraSnippets: true, onAttempt: onCall })
        : await braveContext(query, { country, freshness: freshness(window), onAttempt: onCall })).results,
    };
  }));
}

export async function researchDesk(
  desk: Desk, prompt: string, payload: Record<string, unknown>, window: NewsWindow, home: HomeConfig | null,
): Promise<ResearchAnswer> {
  if (!process.env.BRAVE_SEARCH_API_KEY) throw new DeskResearchError("BRAVE_SEARCH_API_KEY is not set", 0, 0, 0, 0);
  const usage = usageTally();
  const { onUsage } = usage;
  let searchCalls = 0;
  let aiCalls = 0;
  const onAiCall = () => { aiCalls++; };
  try {
    const [firstCount, followupCount] = SEARCH_BUDGET[desk.id];
    const country = desk.locality ? home?.country : undefined;
    const first = await planQueries(desk, prompt, payload, window, firstCount, [], [], onUsage, onAiCall);
    const firstEvidence = await searchRound(first, window, country, "news", () => { searchCalls++; });
    const followup = await planQueries(desk, prompt, payload, window, followupCount, first, firstEvidence, onUsage, onAiCall);
    const evidence = [...firstEvidence, ...await searchRound(followup, window, country, "context", () => { searchCalls++; })];
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
    const finalPrompt = `${prompt}\n\nThe search is complete. Use only the supplied Brave results and extracted page text as evidence. Do not invent an article or event date. A result's publication date alone does not prove when the event happened. Prefer corroborated developments. For each source return its supplied short id and the publisher name. The source must be a specific article, never a section page, homepage or roundup index. Code attaches the exact URL and title; do not write them. Return JSON only.`;
    const override = process.env.NEWS_REASONING_EFFORT?.trim().toLowerCase();
    const effort = override === "low" || override === "medium" || override === "high" ? override : desk.effort;
    onAiCall();
    const answer = await extractJson<{ stories: CitedStory[] }>(finalPrompt, finalInput, {
      schema: DESK_SCHEMA, maxOutputTokens: 9000, reasoningEffort: effort, onUsage,
    });
    return {
      stories: (answer.stories ?? []).map((story) => resolveStorySources(story, sourceById)),
      queries: [...first, ...followup], sources, evidence, searchCalls, aiCalls,
      tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, model: EXTRACTION_MODEL,
    };
  } catch (error) {
    throw new DeskResearchError(error, searchCalls, aiCalls, usage.tokensIn, usage.tokensOut);
  }
}

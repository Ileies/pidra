import { db, braveDailyUsage } from "../db";
import { lt, sql } from "drizzle-orm";
import { recordSearch } from "../util/trace";

const BASE_URL = "https://api.search.brave.com/res/v1";
const MIN_INTERVAL_MS = 1100;
const DAILY_LIMIT = 30;
let nextRequestAt = 0;
let queue = Promise.resolve();

function berlinDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

async function reserveDailyCall(): Promise<void> {
  const [row] = await db.insert(braveDailyUsage)
    .values({ day: berlinDay(), calls: 1 })
    .onConflictDoUpdate({
      target: braveDailyUsage.day,
      set: { calls: sql`${braveDailyUsage.calls} + 1` },
      setWhere: lt(braveDailyUsage.calls, DAILY_LIMIT),
    })
    .returning({ calls: braveDailyUsage.calls });
  if (!row) throw new Error(`Brave Search daily limit of ${DAILY_LIMIT} requests reached`);
}

/** One shared queue paces requests; Postgres enforces the cap across processes. */
function reserveRequest(): Promise<void> {
  const turn = queue.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await Bun.sleep(delay);
    await reserveDailyCall();
    nextRequestAt = Date.now() + MIN_INTERVAL_MS;
  });
  queue = turn.catch(() => {});
  return turn;
}

export interface BraveResult {
  title: string;
  url: string;
  description: string;
  age?: string; // e.g. "2 hours ago"
  publishedAt?: string;
  extraSnippets?: string[];
}

export interface BraveSearchResponse {
  query: string;
  results: BraveResult[];
}

export interface BraveSearchOptions {
  kind?: "web" | "news";
  country?: string;
  freshness?: string;
  extraSnippets?: boolean;
  onAttempt?: () => void;
}

async function braveRequest(url: URL, onAttempt?: () => void): Promise<Response> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY is not set");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    await reserveRequest();
    recordSearch();
    onAttempt?.();
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return res;
      const body = await res.text();
      lastError = new Error(`Brave Search error ${res.status}: ${body.slice(0, 200)}`);
      if (res.status !== 429 && res.status < 500) break;
      if (attempt === 2) break;
      const reset = res.status === 429 ? Number(res.headers.get("x-ratelimit-reset")?.split(",")[0] ?? 1) : 1;
      await Bun.sleep(Math.max(1, Math.min(reset, 10)) * 1000 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await Bun.sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function braveSearch(query: string, count = 5, options: BraveSearchOptions = {}): Promise<BraveSearchResponse> {
  const kind = options.kind ?? "web";
  const url = new URL(`${BASE_URL}/${kind}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  // "any" drops the filter; every other caller keeps the past-day default.
  if (options.freshness !== "any") url.searchParams.set("freshness", options.freshness ?? "pd");
  if (options.country) url.searchParams.set("country", options.country);
  if (options.extraSnippets) url.searchParams.set("extra_snippets", "true");

  const res = await braveRequest(url, options.onAttempt);
  const data = await res.json() as {
    web?: { results?: RawResult[] };
    results?: RawResult[];
  };
  const raw = kind === "news" ? data.results ?? [] : data.web?.results ?? [];

  return {
    query,
    results: raw.slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description ?? "",
      age: r.age ?? r.page_age,
      publishedAt: r.page_age,
      extraSnippets: r.extra_snippets,
    })),
  };
}

/** One search with page text extracted by Brave, within the same request budget. */
export async function braveContext(query: string, options: Pick<BraveSearchOptions, "country" | "freshness" | "onAttempt"> = {}): Promise<BraveSearchResponse> {
  const url = new URL(`${BASE_URL}/llm/context`);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("maximum_number_of_urls", "12");
  url.searchParams.set("maximum_number_of_tokens", "4096");
  url.searchParams.set("maximum_number_of_tokens_per_url", "600");
  url.searchParams.set("context_threshold_mode", "lenient");
  url.searchParams.set("enable_source_metadata", "true");
  if (options.country) url.searchParams.set("country", options.country);
  if (options.freshness) url.searchParams.set("freshness", options.freshness);
  const res = await braveRequest(url, options.onAttempt);
  const data = await res.json() as {
    grounding?: { generic?: { title: string; url: string; snippets?: string[] }[] };
    sources?: Record<string, { age?: string[]; description?: string }>;
  };
  return {
    query,
    results: (data.grounding?.generic ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      description: data.sources?.[item.url]?.description ?? "",
      age: data.sources?.[item.url]?.age?.[2],
      publishedAt: data.sources?.[item.url]?.age?.[3],
      extraSnippets: item.snippets ?? [],
    })),
  };
}

interface RawResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
  page_age?: string;
  extra_snippets?: string[];
}

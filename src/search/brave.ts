const API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const BASE_URL = "https://api.search.brave.com/res/v1/web/search";

export interface BraveResult {
  title: string;
  url: string;
  description: string;
  age?: string; // e.g. "2 hours ago"
}

export interface BraveSearchResponse {
  query: string;
  results: BraveResult[];
}

export async function braveSearch(query: string, count = 5): Promise<BraveSearchResponse> {
  if (!API_KEY) throw new Error("BRAVE_SEARCH_API_KEY is not set");

  const url = new URL(BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("freshness", "pd"); // past day preferred

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brave Search error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { web?: { results?: { title: string; url: string; description: string; page_age?: string }[] } };
  const raw = data.web?.results ?? [];

  return {
    query,
    results: raw.slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description ?? "",
      age: r.page_age,
    })),
  };
}

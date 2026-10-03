import type { Skill } from "../src/skills/loader";
import { braveSearch } from "../src/search/brave";

// Brave's own freshness codes; the model gets plain words.
const FRESHNESS: Record<string, string> = { day: "pd", week: "pw", month: "pm", year: "py", any: "any" };
const KINDS = ["web", "news"] as const;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

const skill: Skill = {
  name: "run_web_search",
  description:
    "Execute a web search query via Brave Search and return top results. Every search uses one of a small shared daily budget, so make each query count",
  risk_level: "low",
  parameters: {
    query: { type: "string", required: true, description: "Search query (max 100 chars)" },
    count: { type: "number", required: false, description: "Number of results (1–10, default 5)" },
    freshness: {
      type: "string",
      required: false,
      description: `How recent results must be: ${Object.keys(FRESHNESS).join(" | ")}. Default: day. Use week, month or year for background, any for evergreen facts`,
    },
    kind: { type: "string", required: false, description: `Search ${KINDS.join(" or ")}. Default: web. news favours recent articles` },
    country: { type: "string", required: false, description: "Two-letter country code to localise results, e.g. CH or DE. Default: none" },
    site: { type: "string", required: false, description: "Only results from this domain, e.g. nzz.ch. Default: any site" },
    extra_snippets: { type: "boolean", required: false, description: "Also return extra text snippets per result. Default: false" },
  },
  execute: async (params) => {
    const query = String(params.query ?? "").trim().slice(0, 100);
    if (!query) throw new Error("query is required");
    const requested = Number(params.count ?? 5);
    const count = Math.min(10, Math.max(1, Number.isFinite(requested) ? Math.round(requested) : 5));

    const freshnessWord = String(params.freshness ?? "").trim().toLowerCase();
    if (freshnessWord && !(freshnessWord in FRESHNESS)) {
      throw new Error(`freshness must be one of ${Object.keys(FRESHNESS).join(", ")} (got "${freshnessWord}")`);
    }

    const kind = String(params.kind ?? "web").trim().toLowerCase();
    if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")} (got "${kind}")`);

    const country = String(params.country ?? "").trim().toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) throw new Error(`country must be a two-letter code (got "${country}")`);

    const site = String(params.site ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (site && !DOMAIN.test(site)) throw new Error(`site must be a domain like example.com (got "${site}")`);

    const extraSnippets = params.extra_snippets === true || String(params.extra_snippets).toLowerCase() === "true";

    const { results } = await braveSearch(site ? `site:${site} ${query}` : query, count, {
      kind: kind as (typeof KINDS)[number],
      freshness: freshnessWord ? FRESHNESS[freshnessWord] : undefined,
      country: country || undefined,
      extraSnippets,
    });
    if (results.length === 0) return "No results found";
    return results
      .map((r, i) => {
        const snippets = extraSnippets && r.extraSnippets?.length ? `\n   ${r.extraSnippets.join("\n   ")}` : "";
        return `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}${snippets}`;
      })
      .join("\n\n");
  },
};

export default skill;

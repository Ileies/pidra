import type { Skill } from "../src/skills/loader";
import { braveSearch } from "../src/search/brave";

const skill: Skill = {
  name: "run_web_search",
  description: "Execute a web search query via Brave Search and return top results",
  risk_level: "low",
  parameters: {
    query: { type: "string", required: true, description: "Search query (max 100 chars)" },
    count: { type: "number", required: false, description: "Number of results (1–10, default 5)" },
  },
  execute: async (params) => {
    const query = String(params.query ?? "").trim().slice(0, 100);
    if (!query) throw new Error("query is required");
    const count = Math.min(10, Math.max(1, Number(params.count ?? 5)));
    const { results } = await braveSearch(query, count);
    if (results.length === 0) return "No results found";
    return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join("\n\n");
  },
};

export default skill;

import type { Skill } from "../src/skills/loader";
import { searchContext, documentOutline } from "../src/context/lookup";

const skill: Skill = {
  name: "read_context",
  description:
    "Search the harvested long-term context: the context document, standing rules, entities, contacts and existing corrections. " +
    "Use this before revising anything, to find the exact wrong wording and the right target_key. " +
    "Pass query='outline' to list the context document's headings, or query='all' with a kind to list everything of that kind (e.g. every standing rule).",
  risk_level: "low",
  parameters: {
    query: { type: "string", required: true, description: "Search term, e.g. a person's name. 'outline' lists the document's headings; 'all' lists every row of the given kind." },
    kind: { type: "string", required: false, description: "Restrict to one of: document | standing_context | entity | contact | correction (default: all)" },
  },
  execute: async (params) => {
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("query is required");

    if (query.toLowerCase() === "outline") {
      const headings = await documentOutline();
      return headings.length > 0
        ? `Context document headings:\n${headings.map((h) => `- ${h}`).join("\n")}`
        : "No context document available.";
    }

    const kind = params.kind ? String(params.kind) : undefined;
    const hits = await searchContext(query, kind);
    if (hits.length === 0) return `No matches for "${query}"${kind ? ` in ${kind}` : ""}.`;

    return hits
      .map((h) => `[${h.kind}] ${h.key}\n${h.text}`)
      .join("\n\n---\n\n");
  },
};

export default skill;

import type { Skill } from "../src/skills/loader";
import { searchContext, documentOutline } from "../src/context/lookup";

const skill: Skill = {
  name: "read_context",
  description:
    "Search the harvested long-term context: the context document, entities, contacts and existing corrections. " +
    "Use this before revising anything, to find the exact wrong wording and the right target_key. " +
    "Pass query='outline' to list the context document's headings, or query='all' with a kind to list everything of that kind (e.g. every contact).",
  risk_level: "low",
  parameters: {
    query: { type: "string", required: true, description: "Search term, e.g. a person's name. 'outline' lists the document's headings; 'all' lists every row of the given kind." },
    kind: { type: "string", required: false, description: "Restrict to one of: document | entity | contact | correction (default: all)" },
    limit: { type: "number", required: false, description: "Most hits per kind, 1 to 50. Default: 8. Raise it with query='all' to read a whole kind" },
    excerpt_chars: { type: "number", required: false, description: "How much of each document section to return, 100 to 5000 characters. Default: 700. Raise it to read a section in full" },
    include_removed: { type: "boolean", required: false, description: "Also list contacts that were removed (marked REMOVED). Default: false" },
  },
  execute: async (params) => {
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("query is required");

    const KINDS = ["document", "entity", "contact", "correction", "all"];
    const kindParam = params.kind ? String(params.kind).trim().toLowerCase() : undefined;
    if (kindParam && !KINDS.includes(kindParam)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);

    const optionalNumber = (value: unknown, name: string): number | undefined => {
      if (value === undefined || value === null || value === "") return undefined;
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
      return n;
    };
    const flag = params.include_removed;
    const includeRemoved = flag === true || String(flag).trim().toLowerCase() === "true";

    if (query.toLowerCase() === "outline") {
      const headings = await documentOutline();
      return headings.length > 0
        ? `Context document headings:\n${headings.map((h) => `- ${h}`).join("\n")}`
        : "No context document available.";
    }

    const kind = kindParam;
    const hits = await searchContext(query, kind, {
      limit: optionalNumber(params.limit, "limit"),
      excerptChars: optionalNumber(params.excerpt_chars, "excerpt_chars"),
      includeRemoved,
    });
    if (hits.length === 0) return `No matches for "${query}"${kind ? ` in ${kind}` : ""}.`;

    return hits
      .map((h) => `[${h.kind}] ${h.key}\n${h.text}`)
      .join("\n\n---\n\n");
  },
};

export default skill;

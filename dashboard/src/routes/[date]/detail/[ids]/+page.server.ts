import type { PageServerLoad, Actions } from "./$types";
import { error, fail } from "@sveltejs/kit";
import { marked } from "marked";
import { sql } from "$lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIds(raw: string): string[] {
  return raw.split(",").filter((id) => UUID_RE.test(id)).slice(0, 10);
}

export const load: PageServerLoad = async ({ params }) => {
  const { date, ids } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, "Invalid date");

  const idList = parseIds(ids);
  if (idList.length === 0) error(400, "No valid item IDs");

  const db = sql();
  const items = await db`
    SELECT
      e.id,
      e.extracted_json,
      e.relevance_score,
      e.effective_relevance,
      e.novelty,
      r.source_type,
      r.source_name,
      r.raw_content,
      r.received_at
    FROM extractions e
    JOIN raw_items r ON r.id = e.raw_item_id
    WHERE e.id::text = ANY(${idList})
    ORDER BY e.effective_relevance DESC NULLS LAST
  `;

  if (items.length === 0) error(404, "Items not found");

  return {
    date,
    ids,
    items: items.map((row) => ({
      id: row.id as string,
      sourceName: row.source_name as string | null,
      sourceType: row.source_type as string,
      receivedAt: row.received_at as string | null,
      rawContent: row.raw_content as string | null,
      novelty: row.novelty as string | null,
      relevanceScore: row.relevance_score as number | null,
      effectiveRelevance: row.effective_relevance as number | null,
      extracted: row.extracted_json as {
        headline?: string;
        key_claim?: string;
        topic_tags?: string[];
        entities?: string[];
        type?: string;
        urgency?: string;
        action_required?: string | null;
        deadline?: string | null;
      } | null,
    })),
  };
};

export const actions: Actions = {
  zusammenfassen: async ({ params }) => {
    const { date, ids } = params;
    const idList = parseIds(ids);
    if (idList.length === 0) return fail(400, { error: "Keine gültigen IDs" });

    try {
      const res = await fetch("http://localhost:4000/api/deepen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idList, date }),
      });
      if (!res.ok) return fail(502, { error: "Deepen-Aufruf fehlgeschlagen" });
      const { text } = (await res.json()) as { text: string };
      return { deepDiveHtml: marked(text) as string };
    } catch {
      return fail(503, { error: "Skills bridge nicht erreichbar (localhost:4000)" });
    }
  },
};

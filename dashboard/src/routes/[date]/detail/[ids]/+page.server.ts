import type { PageServerLoad, Actions } from "./$types";
import { error, fail } from "@sveltejs/kit";
import { renderMarkdown } from "#lib/markdown.js";
import { loadExtractions, parseIds, rateExtraction, UUID_RE } from "#lib/server/extractions.js";

export const load: PageServerLoad = async ({ params }) => {
  const { date, ids } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const idList = parseIds(ids);
  if (idList.length === 0) error(400, "No valid item IDs");

  const items = await loadExtractions(idList);
  if (items.length === 0) error(404, "Items not found");

  return { date, ids, items };
};

export const actions: Actions = {
  rate: async ({ request }) => {
    const data = await request.formData();
    const extractionId = (data.get("extraction_id") as string | null)?.trim();
    const signal = data.get("signal") as string | null;

    if (!extractionId || !UUID_RE.test(extractionId)) return fail(400, { error: "Invalid extraction id" });
    if (signal !== "1" && signal !== "-1") return fail(400, { error: "Invalid signal" });

    return { rated: extractionId, eventType: await rateExtraction(extractionId, signal) };
  },

  deepen: async ({ params }) => {
    const { date, ids } = params;
    const idList = parseIds(ids);
    if (idList.length === 0) return fail(400, { error: "No valid item IDs" });

    try {
      const res = await fetch("http://localhost:4000/api/deepen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idList, date }),
      });
      if (!res.ok) return fail(502, { error: "The deep-dive call failed." });
      const { text } = (await res.json()) as { text: string };
      return { deepDiveHtml: renderMarkdown(text) };
    } catch {
      return fail(503, { error: "The skills bridge is not reachable (localhost:4000)." });
    }
  },
};

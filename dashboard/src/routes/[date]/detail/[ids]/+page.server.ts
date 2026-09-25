import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { renderMarkdown } from "#lib/markdown.js";
import { parseIds, UUID_RE } from "#lib/ids.js";
import { rateExtraction } from "#lib/server/extractions.js";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** Actions only. The read side moved to `+page.ts`; see `[date]/+page.server.ts`
 *  for why a co-located `load` here would never run for a client-side navigation now. */
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
      const res = await fetch(`${API}/api/deepen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idList, date }),
      });
      if (!res.ok) return fail(502, { error: "The deep-dive call failed." });
      const { text } = (await res.json()) as { text: string };
      return { deepDiveHtml: renderMarkdown(text) };
    } catch {
      return fail(503, { error: `The skills bridge is not reachable (${API}).` });
    }
  },
};

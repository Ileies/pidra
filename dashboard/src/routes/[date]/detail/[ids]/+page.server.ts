import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { renderMarkdown } from "#lib/markdown.js";
import { parseIds, UUID_RE } from "#lib/ids.js";
import { rateExtraction } from "#lib/server/extractions.js";
import { bridgeAction, jsonPost } from "#lib/server/bridge.js";

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

    return bridgeAction("/api/deepen", jsonPost({ ids: idList, date }), (body: { text: string }) => ({
      deepDiveHtml: renderMarkdown(body.text),
    }));
  },
};

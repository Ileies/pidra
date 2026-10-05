import type { Actions } from "./$types";
import { readForm } from "#lib/server/form.js";
import { fail } from "@sveltejs/kit";
import { renderMarkdown } from "#lib/markdown.js";
import { parseIds, UUID_RE } from "#lib/ids.js";
import { rateExtraction } from "#lib/server/extractions.js";
import { bridgeAction, jsonPost } from "#lib/server/bridge.js";

/** Actions only (`rate`, and `deepen`, a model call through the bridge: online only). The read side is `+page.ts`; see `[date]/+page.server.ts`. */
export const actions: Actions = {
  rate: async ({ request }) => {
    const form = await readForm(request);
    const extractionId = form.text("extraction_id");
    const signal = form.text("signal");

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

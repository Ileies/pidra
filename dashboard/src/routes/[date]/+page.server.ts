import type { Actions } from "./$types";
import { readForm } from "#lib/server/form.js";
import { fail } from "@sveltejs/kit";
import { rateExtraction, UUID_RE } from "#lib/server/extractions.js";
import { bridgeAction } from "#lib/server/bridge.js";

/**
 * Actions only. The read side moved to `+page.ts`: with the page on
 * `ssr = false`, a co-located `load` here would never run for a client-side navigation - it is
 * `+page.ts` (universal) that runs, reading through `#lib/offline/repo.js`. Form actions are
 * unaffected by `ssr`; they always execute on the server when a form submits.
 */
export const actions: Actions = {
  runPipeline: () => bridgeAction("/api/pipeline/run", { method: "POST" }, () => ({ triggered: true })),

  /**
   * Rating from inside the report (C4). `feedback_events` only filled up if the reader took a
   * two-click detour to the detail page, which starved the relevance calibration loop.
   */
  rate: async ({ request }) => {
    const form = await readForm(request);
    const extractionId = form.text("extraction_id");
    const signal = form.text("signal");

    if (!extractionId || !UUID_RE.test(extractionId)) return fail(400, { error: "Invalid extraction id" });
    if (signal !== "1" && signal !== "-1") return fail(400, { error: "Invalid signal" });

    const eventType = await rateExtraction(extractionId, signal);
    if (!eventType) return fail(404, { error: "Extraction not found" });
    return { rated: extractionId, eventType };
  },
};

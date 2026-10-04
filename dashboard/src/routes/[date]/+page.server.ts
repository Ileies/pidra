import type { Actions } from "./$types";
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
    const data = await request.formData();
    const extractionId = (data.get("extraction_id") as string | null)?.trim();
    const signal = data.get("signal") as string | null;

    if (!extractionId || !UUID_RE.test(extractionId)) return fail(400, { error: "Invalid extraction id" });
    if (signal !== "1" && signal !== "-1") return fail(400, { error: "Invalid signal" });

    return { rated: extractionId, eventType: await rateExtraction(extractionId, signal) };
  },
};

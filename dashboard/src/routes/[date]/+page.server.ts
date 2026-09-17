import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { rateExtraction, UUID_RE } from "#lib/server/extractions.js";

/**
 * Actions only. The read side moved to `+page.ts` (OFFLINE_PLAN.md O2): with the page on
 * `ssr = false`, a co-located `load` here would never run for a client-side navigation - it is
 * `+page.ts` (universal) that runs, reading through `#lib/offline/repo.js`. Form actions are
 * unaffected by `ssr`; they always execute on the server when a form submits.
 */
export const actions: Actions = {
  runPipeline: async () => {
    try {
      const res = await fetch("http://localhost:4000/api/pipeline/run", { method: "POST" });
      if (!res.ok) return fail(502, { error: "The skills bridge returned an error." });
      return { triggered: true };
    } catch {
      return fail(503, { error: "The skills bridge is not running." });
    }
  },

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

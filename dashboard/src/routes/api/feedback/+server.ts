import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { rateExtraction, UUID_RE } from "#lib/server/extractions.js";

/**
 * JSON twin of the `?/rate` form actions on `/[date]` and `/[date]/detail/[ids]`, and the offline
 * outbox's `rate` intent (OFFLINE_PLAN.md §6). Both call `rateExtraction()`, so a rating given
 * offline and one given from the report itself cannot land differently. Naturally idempotent:
 * `rateExtraction` deletes then inserts, so replaying the same rating twice is a no-op.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { extraction_id?: string; signal?: string };
  const extractionId = (body.extraction_id ?? "").trim();
  const signal = body.signal;

  if (!extractionId || !UUID_RE.test(extractionId)) return json({ error: "Invalid extraction id" }, { status: 400 });
  if (signal !== "1" && signal !== "-1") return json({ error: "Invalid signal" }, { status: 400 });

  const eventType = await rateExtraction(extractionId, signal);
  return json({ rated: extractionId, eventType });
};

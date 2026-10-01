import { json } from "@sveltejs/kit";
import { parseIds } from "#lib/ids.js";
import { loadExtractions } from "#lib/server/extractions.js";

/**
 * Live read of extractions by id, for the detail page when the mirror does not hold them. The
 * mirror only carries items a report cites within the last MIRROR_DAYS, while `/sources/[name]`
 * links every delivery, including filtered ones and ones from older days.
 */
export const GET = async ({ url }) => {
  const ids = parseIds(url.searchParams.get("ids") ?? "");
  if (ids.length === 0) return json({ items: [] }, { status: 400 });
  return json({ items: await loadExtractions(ids, { withRawContent: false }) });
};

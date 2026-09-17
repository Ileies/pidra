import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { loadExtractions, parseIds } from "#lib/server/extractions.js";

/**
 * The items behind one report entry (C5).
 *
 * "More on this" used to navigate to `/[date]/detail/[ids]` and lose the reader's place in a
 * report several screens long. It expands in place now, and this is what it fetches. The deep
 * link still works and is still the shareable form.
 *
 * Raw email bodies are left out: the inline expansion does not show them, and they are by far
 * the largest field.
 */
export const GET: RequestHandler = async ({ url }) => {
  const ids = parseIds(url.searchParams.get("ids") ?? "");
  if (ids.length === 0) return json({ error: "No valid extraction ids" }, { status: 400 });

  return json({ items: await loadExtractions(ids, { withRawContent: false }) });
};

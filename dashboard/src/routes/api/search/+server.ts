import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { search } from "$lib/server/search";

/**
 * What the command palette calls (D8). The UI knows nothing about how the ranking was produced,
 * which is what keeps the parked semantic version an addition rather than a rewrite (§12).
 */
export const GET: RequestHandler = async ({ url }) => {
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 2) return json({ hits: [] });

  return json({ hits: await search(query, { limit: 20 }) });
};

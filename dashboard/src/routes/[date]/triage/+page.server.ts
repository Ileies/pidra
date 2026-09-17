import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { loadTriage } from "#lib/server/triage.js";

export const load: PageServerLoad = async ({ params }) => {
  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const { items, summary } = await loadTriage(date);
  return { date, items, summary };
};

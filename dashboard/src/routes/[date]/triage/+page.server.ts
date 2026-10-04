import { isDateKey } from "$pipeline/util/ids";
import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { loadTriage } from "#lib/server/triage.js";

export const load: PageServerLoad = async ({ params }) => {
  const { date } = params;
  if (!isDateKey(date)) error(404, "Not found");

  const { items, summary } = await loadTriage(date);
  return { date, items, summary };
};

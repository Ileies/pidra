import { isDateKey } from "$pipeline/util/ids";
import type { RequestHandler } from "./$types";
import { bridgeProxy } from "#lib/server/bridge.js";

// The chapters of a report and their spoken length. The text comes from the stored report on the
// skills bridge, so this only forwards.

export const GET: RequestHandler = async ({ params }) => {
  if (!isDateKey(params.date)) return Response.json({ error: "Invalid date" }, { status: 400 });

  return bridgeProxy(`/api/report-audio/${params.date}`, {}, { headers: { "Cache-Control": "no-store" } });
};

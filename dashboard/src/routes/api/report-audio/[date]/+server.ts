import { isDateKey } from "$pipeline/util/ids";
import { errMessage } from "$pipeline/util/text";
import type { RequestHandler } from "./$types";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

// The chapters of a report and their spoken length. The text comes from the stored report on the
// skills bridge, so this only forwards.
const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const GET: RequestHandler = async ({ params }) => {
  if (!isDateKey(params.date)) return Response.json({ error: "Invalid date" }, { status: 400 });

  try {
    const res = await fetch(`${API}/api/report-audio/${params.date}`);
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { error: `Skills bridge unreachable at ${API}: ${errMessage(err)}` },
      { status: 502 },
    );
  }
};

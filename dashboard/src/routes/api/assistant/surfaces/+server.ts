import type { RequestHandler } from "./$types";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

// Fetched when the widget is first opened rather than in a layout load: the surface registry is
// nice to have, and a dead bridge must not take every dashboard page down with it.
const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const GET: RequestHandler = async () => {
  try {
    const res = await fetch(`${API}/api/assistant/surfaces`);
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return Response.json({ error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
};

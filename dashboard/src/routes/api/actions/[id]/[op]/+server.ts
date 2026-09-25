import type { RequestHandler } from "./$types";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

// A quick action runs its skill on the skills bridge, through `executeSkill()` and
// `src/actions/store.ts`, the only writer of `report_actions`. The dashboard only proxies. Never
// queued offline: it writes to Google Calendar or Tasks, where a replay days later against an
// event that has moved on is the wrong thing to do on the owner's behalf.
const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

const OPS = new Set(["run", "dismiss", "restore"]);

export const POST: RequestHandler = async ({ params }) => {
  if (!OPS.has(params.op)) return Response.json({ error: "Unknown operation" }, { status: 404 });

  try {
    const res = await fetch(`${API}/api/actions/${encodeURIComponent(params.id)}/${params.op}`, { method: "POST" });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: `The skills bridge is not reachable (${API}).` }, { status: 502 });
  }
};

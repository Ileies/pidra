import type { RequestHandler } from "./$types";
import { bridgeProxy } from "#lib/server/bridge.js";

// A quick action runs its skill on the skills bridge, through `executeSkill()` and
// `src/actions/store.ts`, the only writer of `report_actions`. The dashboard only proxies. Never
// queued offline: it writes to Google Calendar or Tasks, where a replay days later against an
// event that has moved on is the wrong thing to do on the owner's behalf.
const OPS = new Set(["run", "dismiss", "restore"]);

export const POST: RequestHandler = async ({ params }) => {
  if (!OPS.has(params.op)) return Response.json({ error: "Unknown operation" }, { status: 404 });

  return bridgeProxy(`/api/actions/${encodeURIComponent(params.id)}/${params.op}`, { method: "POST" });
};

import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { startRun, getStatus } from "$lib/server/contextBuilder";

export const POST: RequestHandler = async ({ request }) => {
  const status = await getStatus();
  if (status.running) {
    return json({ ok: false, error: "A run is already in progress." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === "full" || body?.mode === "update" ? body.mode : null;

  const result = startRun(mode);
  if (!result.ok) return json(result, { status: 409 });
  return json(result);
};

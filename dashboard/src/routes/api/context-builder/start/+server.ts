import type { RequestHandler } from "./$types";
import { startRun, getStatus } from "#lib/server/contextBuilder.js";

export const POST: RequestHandler = async ({ request }) => {
  const status = await getStatus();
  if (status.running) {
    return Response.json({ ok: false, error: "A run is already in progress." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === "full" || body?.mode === "update" ? body.mode : null;

  const result = startRun(mode);
  if (!result.ok) return Response.json(result, { status: 409 });
  return Response.json(result);
};

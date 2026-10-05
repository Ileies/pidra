import type { RequestHandler } from "./$types";
import { stopRun } from "#lib/server/contextBuilder.js";

// Called by `useContextRun`; 409 when nothing is running.
export const POST: RequestHandler = async () => {
  const result = stopRun();
  if (!result.ok) return Response.json(result, { status: 409 });
  return Response.json(result);
};

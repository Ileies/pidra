import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { stopRun } from "#lib/server/contextBuilder.js";

export const POST: RequestHandler = async () => {
  const result = stopRun();
  if (!result.ok) return json(result, { status: 409 });
  return json(result);
};

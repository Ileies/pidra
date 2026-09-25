import type { RequestHandler } from "./$types";
import { getStatus } from "#lib/server/contextBuilder.js";

export const GET: RequestHandler = async () => {
  return Response.json(await getStatus());
};

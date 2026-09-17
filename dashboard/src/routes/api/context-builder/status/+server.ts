import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { getStatus } from "#lib/server/contextBuilder.js";

export const GET: RequestHandler = async () => {
  return json(await getStatus());
};

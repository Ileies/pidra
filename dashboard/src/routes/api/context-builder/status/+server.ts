import type { RequestHandler } from "./$types";
import { getStatus } from "#lib/server/contextBuilder.js";

// Polled every 2s by `useContextRun`; shape is `ContextBuilderStatus` (lib/server/contextBuilder.ts).
export const GET: RequestHandler = async () => {
  return Response.json(await getStatus());
};

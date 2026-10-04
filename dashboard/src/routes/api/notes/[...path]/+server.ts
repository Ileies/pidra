import type { RequestHandler } from "./$types";
import { bridgeProxy } from "#lib/server/bridge.js";

// Note writes live on the skills bridge, because `src/notes/store.ts` there is the only writer of
// `notes` and `note_revisions` - the same store the note skills use. The dashboard only proxies,
// so a UI edit and a chat edit cannot drift apart or skip the revision trail.
const handler: RequestHandler = async ({ request, params, url }) => {
  const body = request.method === "GET" || request.method === "DELETE" ? null : (await request.text()) || null;
  return bridgeProxy(`/api/notes${params.path ? `/${params.path}` : ""}${url.search}`, {
    method: request.method,
    headers: body === null ? undefined : { "Content-Type": "application/json" },
    body,
  });
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;

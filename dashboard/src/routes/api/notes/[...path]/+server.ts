import type { RequestHandler } from "./$types";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

// Note writes live on the skills bridge, because `src/notes/store.ts` there is the only writer of
// `notes` and `note_revisions` - the same store the note skills use. The dashboard only proxies,
// so a UI edit and a chat edit cannot drift apart or skip the revision trail.
const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

async function proxy(method: string, path: string, search: string, body: string | null) {
  const url = `${API}/api/notes${path ? `/${path}` : ""}${search}`;

  try {
    const res = await fetch(url, {
      method,
      headers: body === null ? undefined : { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    // A dead bridge is the common failure, and worth naming rather than showing a generic
    // fetch error in a toast.
    return Response.json(
      { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}

const handler: RequestHandler = async ({ request, params, url }) => {
  const body = request.method === "GET" || request.method === "DELETE" ? null : await request.text();
  return proxy(request.method, params.path ?? "", url.search, body || null);
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;

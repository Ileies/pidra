import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

// The chat loop runs on the skills bridge, because that is where the skill registry lives. The
// dashboard only proxies, so the bridge stays on localhost and is never internet-exposed.
const API = env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "message is required" }, { status: 400 });

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversation_id: body.conversation_id ?? undefined,
        context: body.context ?? undefined,
        origin: body.origin ?? "page",
      }),
    });
    return json(await res.json(), { status: res.status });
  } catch (err) {
    // A dead bridge is the common failure here, and it is worth naming rather than showing a
    // generic fetch error in the chat window.
    return json(
      { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
};

import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

// The turn loop runs on the skills bridge, because that is where the skill registry lives. This
// only forwards, and passes the event stream straight through so tool calls reach the widget as
// they execute.
const API = env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();

  try {
    const res = await fetch(`${API}/api/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    // A validation failure comes back as JSON, not as a stream.
    if (!res.ok || !res.headers.get("Content-Type")?.includes("text/event-stream")) {
      return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
      });
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return json(
      { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
};

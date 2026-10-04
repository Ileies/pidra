import type { RequestHandler } from "./$types";
import { bridgeProxy, jsonPost } from "#lib/server/bridge.js";

// The chat loop runs on the skills bridge, because that is where the skill registry lives. The
// dashboard only proxies, so the bridge stays on localhost and is never internet-exposed.

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });

  return bridgeProxy("/api/chat", jsonPost({
    message,
    conversation_id: body.conversation_id ?? undefined,
    context: body.context ?? undefined,
    origin: body.origin ?? "page",
  }));
};

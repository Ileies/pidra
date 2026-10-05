import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sendMessage, streamMessage, type TurnContextInput } from "../../ai/chat";
import { SURFACES, SURFACES_LIST } from "../../ai/surfaces";
import { isUuid } from "../../util/ids";
import { errMessage } from "../../util/text";
import { bodyOf } from "../http";

interface ChatRequest {
  message: string;
  conversation_id: string;
  /** The dashboard page the turn was sent from. Untrusted: `normaliseContext` caps and resolves it. */
  context: TurnContextInput;
  origin: string;
}

function chatRequestError(body: Partial<ChatRequest>): string | null {
  if (typeof body.message !== "string" || !body.message.trim()) return "message is required";
  if (body.conversation_id && !isUuid(body.conversation_id)) return "Invalid conversation_id";
  return null;
}

export const chat = new Hono();

chat.post("/api/chat", async (c) => {
  const body = await bodyOf<ChatRequest>(c);
  const invalid = chatRequestError(body);
  if (invalid) return c.json({ error: invalid }, 400);

  try {
    return c.json(await sendMessage(body.message!.trim(), body.conversation_id, body.context, body.origin ?? "page"));
  } catch (err) {
    return c.json({ error: errMessage(err) }, 500);
  }
});

/** The surface registry, so the widget renders per-page hints from one source of truth. */
chat.get("/api/assistant/surfaces", (c) =>
  c.json(Object.fromEntries(
    SURFACES_LIST.map((surface) => [surface, {
      label: SURFACES[surface].label,
      hints: SURFACES[surface].hints,
      notice: SURFACES[surface].notice ?? null,
      skills: SURFACES[surface].skills,
    }]),
  )));

/**
 * The same turn loop as `/api/chat`, streamed as server-sent events. Tool calls reach the widget
 * as they execute, which is what keeps a flex-tier turn from looking like a hung spinner.
 */
chat.post("/api/assistant/chat", async (c) => {
  const body = await bodyOf<ChatRequest>(c);
  const invalid = chatRequestError(body);
  if (invalid) return c.json({ error: invalid }, 400);

  return streamSSE(c, async (stream) => {
    // Flex-tier calls can be quiet for minutes; the heartbeat keeps the connection alive (the client ignores `ping`).
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
    }, 15_000);

    try {
      for await (const event of streamMessage(body.message!.trim(), body.conversation_id, body.context, body.origin ?? "widget")) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message: errMessage(err) }),
      });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

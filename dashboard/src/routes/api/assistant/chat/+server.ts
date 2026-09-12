import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { isShuttingDown, registerStream } from "$lib/server/shutdown";

// The turn loop runs on the skills bridge, because that is where the skill registry lives. This
// only forwards, and passes the event stream straight through so tool calls reach the widget as
// they execute.
const API = env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

const encoder = new TextEncoder();

/** One SSE frame in the shape the widget's `#handle` already understands. */
function frame(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const RESTART_MESSAGE =
  "The dashboard restarted and cut this turn short. Reopen the conversation to see what it saved.";

export const POST: RequestHandler = async ({ request }) => {
  // A turn started now would be killed seconds later, halfway through whatever skills it decided
  // to call. Refusing is the honest answer; the widget puts the draft back on a failed turn.
  if (isShuttingDown()) {
    return json({ error: "The dashboard is restarting. Try again in a moment." }, { status: 503 });
  }

  const body = await request.text();
  // The upstream fetch outlives this handler - it is what the returned stream reads from - so
  // shutdown needs a handle on it. Without one it keeps the event loop alive after the client
  // socket is gone, which is what made a redeploy wait for systemd's SIGKILL.
  const upstream = new AbortController();

  try {
    const res = await fetch(`${API}/api/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: upstream.signal,
    });

    // A validation failure comes back as JSON, not as a stream.
    if (!res.ok || !res.body || !res.headers.get("Content-Type")?.includes("text/event-stream")) {
      return new Response(await res.text(), {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
      });
    }

    return new Response(relay(res.body, upstream), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    upstream.abort();
    return json(
      { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
};

/**
 * Forward the bridge's events, but keep the ability to end the stream from this side.
 *
 * A plain `new Response(res.body)` pass-through has no such handle: on SIGTERM the client sees a
 * socket die mid-turn with no explanation, and the outbound fetch behind it holds the process
 * open until it is killed. Here the stream is registered with `shutdown.ts`, so a signal ends it
 * with a frame the widget renders as an error and then closes it for good.
 */
function relay(source: ReadableStream<Uint8Array>, upstream: AbortController): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let closed = false;

      /** Close once, optionally with a last frame. Every later enqueue would throw. */
      const finish = (last?: Uint8Array) => {
        if (closed) return;
        closed = true;
        if (last) controller.enqueue(last);
        controller.close();
      };

      const unregister = registerStream(() => {
        finish(frame("error", { type: "error", message: RESTART_MESSAGE }));
        upstream.abort();
        // Unblocks the read below, so the pump does not sit on a stream nobody is draining.
        reader.cancel().catch(() => {});
      });

      try {
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (closed) break;
          controller.enqueue(value);
        }
        finish();
      } catch (err) {
        // An aborted read during shutdown is expected and already has its frame. Anything else is
        // the bridge failing mid-turn, which the widget should hear about rather than infer.
        finish(frame("error", { type: "error", message: err instanceof Error ? err.message : String(err) }));
      } finally {
        unregister();
      }
    },

    // The client went away: stop the bridge streaming into nothing.
    cancel() {
      upstream.abort();
    },
  });
}

import { browser } from "$app/environment";
import { invalidateAll } from "$app/navigation";
import { surfaceForRoute, type PageContext, type Surface } from "$lib/assistant/pageContext";

/**
 * The floating assistant's client state. Lives in the root layout, so it survives navigation
 * between pages: a turn started on /notes keeps streaming while the user walks to the report.
 */

export interface UiToolCall {
  name: string;
  arguments: Record<string, unknown>;
  status?: string;
  message?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: UiToolCall[];
}

/** A row of a stored transcript, as /chat's load function returns it. */
export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  tool_calls: { name: string; arguments?: Record<string, unknown>; status?: string; result?: string }[] | null;
}

export interface SurfaceInfo {
  label: string;
  hints: string[];
  notice: string | null;
  skills: string[];
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const STORAGE_OPEN = "pidra.assistant.open";
const STORAGE_CONVERSATION = "pidra.assistant.conversation";
const STORAGE_DRAFT = "pidra.assistant.draft";

function readStored(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStored(store: "local" | "session", key: string, value: string | null) {
  try {
    const target = store === "local" ? localStorage : sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // Private windows and blocked site data: the widget works without persistence.
  }
}

class Assistant {
  open = $state(false);
  expanded = $state(false);
  draft = $state("");
  streaming = $state(false);
  error = $state<string | null>(null);
  messages = $state<UiMessage[]>([]);
  conversationId = $state<string | null>(null);
  /** A write landed while the panel was closed: the button gets a dot. */
  unseen = $state(false);
  /** Rows the last turn wrote, for the change highlight on the page. */
  touchedIds = $state<Set<string>>(new Set());
  /** The user asked for a fresh conversation: do not re-hydrate the old one over it. */
  composingNew = $state(false);

  context = $state<PageContext>({ surface: "global", route: "/" });
  surfaces = $state<Record<string, SurfaceInfo> | null>(null);

  #controller: AbortController | null = null;
  #restored = false;

  get surface(): Surface {
    return this.context.surface;
  }

  get info(): SurfaceInfo | null {
    return this.surfaces?.[this.surface] ?? null;
  }

  /** Called once from the layout, on the client only. */
  restore() {
    if (this.#restored) return;
    this.#restored = true;
    this.open = readStored("local", STORAGE_OPEN) === "1";
    this.conversationId = readStored("session", STORAGE_CONVERSATION);
    this.draft = readStored("local", STORAGE_DRAFT) ?? "";
    if (this.open) this.loadSurfaces();
  }

  setContext(context: PageContext) {
    this.context = context;
  }

  /** Fallback for a page that does not declare its own context. */
  setRoute(pathname: string) {
    if (this.context.route === pathname) return;
    this.context = { surface: surfaceForRoute(pathname), route: pathname };
  }

  toggle() {
    this.open = !this.open;
    writeStored("local", STORAGE_OPEN, this.open ? "1" : "0");
    if (this.open) {
      this.unseen = false;
      this.loadSurfaces();
    }
  }

  close() {
    this.open = false;
    writeStored("local", STORAGE_OPEN, "0");
  }

  setDraft(value: string) {
    this.draft = value;
    writeStored("local", STORAGE_DRAFT, value);
  }

  newConversation() {
    this.conversationId = null;
    this.messages = [];
    this.error = null;
    this.composingNew = true;
    writeStored("session", STORAGE_CONVERSATION, null);
  }

  /**
   * Hydrate from a stored transcript, so /chat and the widget share one conversation instead of
   * keeping two. Never while a turn is streaming, and never over a deliberately empty composer.
   */
  adopt(conversationId: string | null, rows: StoredMessage[]) {
    if (this.streaming || this.composingNew) return;
    if (conversationId === this.conversationId && rows.length <= this.messages.length) return;

    this.conversationId = conversationId;
    this.messages = rows.map((row) => ({
      id: row.id,
      role: row.role === "user" ? "user" : "assistant",
      content: row.content,
      toolCalls: (row.tool_calls ?? []).map((call) => ({
        name: call.name,
        arguments: call.arguments ?? {},
        status: call.status ?? "executed",
        message: call.result ?? "",
      })),
    }));
    writeStored("session", STORAGE_CONVERSATION, conversationId);
  }

  async loadSurfaces() {
    if (this.surfaces) return;
    try {
      const res = await fetch("/api/assistant/surfaces");
      if (res.ok) this.surfaces = await res.json();
    } catch {
      // Hints are a nicety; the assistant works without them.
    }
  }

  /** Stop the turn in flight. The writes it already made stand, and stay in the transcript. */
  cancel() {
    this.#controller?.abort();
    this.#controller = null;
    this.streaming = false;
  }

  async send(text: string) {
    const message = text.trim();
    if (!message || this.streaming) return;

    this.error = null;
    this.setDraft("");
    this.touchedIds = new Set();

    const stamp = Date.now();
    const reply: UiMessage = { id: `assistant-${stamp}`, role: "assistant", content: "", toolCalls: [] };
    this.messages = [...this.messages, { id: `user-${stamp}`, role: "user", content: message, toolCalls: [] }, reply];
    this.streaming = true;

    const controller = new AbortController();
    this.#controller = controller;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversation_id: this.conversationId ?? undefined,
          context: this.context,
          origin: "widget",
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text();
        let parsed: { error?: string } | null = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          // Not JSON: show the raw body, truncated.
        }
        throw new Error(parsed?.error ?? body.slice(0, 300) ?? `Request failed (${res.status})`);
      }

      await this.#consume(res.body, reply);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        this.#patchReply(reply, (current) => ({
          ...current,
          content: current.content || "Stopped.",
        }));
      } else {
        this.error = err instanceof Error ? err.message : String(err);
        // The draft comes back so a failed turn does not eat the message.
        this.setDraft(message);
        this.messages = this.messages.filter((entry) => entry.id !== reply.id);
      }
    } finally {
      this.streaming = false;
      this.#controller = null;
    }
  }

  /** Server-sent events, one JSON payload per `data:` line. */
  async #consume(body: ReadableStream<Uint8Array>, reply: UiMessage) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            await this.#handle(JSON.parse(payload), reply);
          } catch {
            // A malformed frame is not worth killing the turn over.
          }
        }
      }
    }
  }

  async #handle(event: Record<string, unknown>, reply: UiMessage) {
    const type = String(event.type ?? "");

    if (type === "conversation") {
      this.composingNew = false;
      this.conversationId = String(event.id);
      writeStored("session", STORAGE_CONVERSATION, this.conversationId);
      return;
    }

    if (type === "text") {
      this.#patchReply(reply, (current) => ({ ...current, content: String(event.text ?? "") }));
      return;
    }

    if (type === "tool_call") {
      const call: UiToolCall = {
        name: String(event.name ?? ""),
        arguments: (event.arguments as Record<string, unknown>) ?? {},
      };
      this.#patchReply(reply, (current) => ({ ...current, toolCalls: [...current.toolCalls, call] }));
      return;
    }

    if (type === "tool_result") {
      const name = String(event.name ?? "");
      this.#patchReply(reply, (current) => {
        const calls = [...current.toolCalls];
        // The pending call for this name, newest first: a turn can call the same skill twice.
        for (let index = calls.length - 1; index >= 0; index--) {
          if (calls[index].name === name && !calls[index].status) {
            calls[index] = { ...calls[index], status: String(event.status ?? ""), message: String(event.message ?? "") };
            return { ...current, toolCalls: calls };
          }
        }
        return {
          ...current,
          toolCalls: [...calls, { name, arguments: {}, status: String(event.status ?? ""), message: String(event.message ?? "") }],
        };
      });
      return;
    }

    if (type === "done") {
      const touched = (event.touched as string[]) ?? [];
      if (touched.length > 0) {
        this.touchedIds = this.#idsFrom(reply);
        if (!this.open) this.unseen = true;
        // The page the user is on now shows stale rows: reload its data.
        await invalidateAll();
      }
      return;
    }

    if (type === "error") {
      this.error = String(event.message ?? "Unknown error");
    }
  }

  #patchReply(reply: UiMessage, patch: (current: UiMessage) => UiMessage) {
    this.messages = this.messages.map((entry) => (entry.id === reply.id ? patch(entry) : entry));
  }

  /**
   * Which rows to highlight. Ids are taken from what the skills were called with and what they
   * answered, which covers both an edit (`note_id` in the arguments) and a create (the id in the
   * result text).
   */
  #idsFrom(reply: UiMessage): Set<string> {
    const current = this.messages.find((entry) => entry.id === reply.id) ?? reply;
    const ids = new Set<string>();

    for (const call of current.toolCalls) {
      if (call.status !== "executed") continue;
      for (const value of Object.values(call.arguments)) {
        if (typeof value === "string") for (const match of value.match(UUID_IN_TEXT) ?? []) ids.add(match.toLowerCase());
      }
      for (const match of call.message?.match(UUID_IN_TEXT) ?? []) ids.add(match.toLowerCase());
    }

    return ids;
  }
}

export const assistant = new Assistant();

/**
 * A page declares what it is showing, once, in an `$effect`. Lives here rather than in
 * `pageContext.ts` so that module stays free of runes and importable from anywhere.
 */
export function setPageContext(context: PageContext) {
  // Server-side no-op: module state is shared across requests there, and the widget is a
  // client-only thing anyway. Pages still on legacy reactive statements call this during SSR.
  if (!browser) return;
  assistant.setContext(context);
}

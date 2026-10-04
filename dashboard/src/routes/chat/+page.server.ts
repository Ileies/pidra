import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { renameConversation, deleteConversation, ConversationError } from "#lib/server/chatConversations.js";

export interface ChatToolCall {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status?: string;
}

/**
 * Reads the transcript straight from Postgres like every other dashboard page; only sending a
 * message goes through the bridge, because that is where the skill registry and the model call
 * live. Rename and delete are dashboard-only writes, in `#lib/server/chatConversations.js`.
 */
// postgres.js hands back timestamptz as a Date; the page only formats it, and a Date does not
// survive the serialisation boundary as one, so it is normalised here.
const iso = (value: unknown): string => new Date(value as string).toISOString();

export const load: PageServerLoad = async ({ url }) => {
  const db = sql();

  const requested = url.searchParams.get("c");
  // No param (or `?c=new`) is an empty composer. The page itself carries the live conversation
  // over a client-side navigation by redirecting to `?c=<id>`; a fresh load always starts new.
  const activeId = requested && isUuid(requested) ? requested : null;

  const [conversations, messages, corrections] = await Promise.all([
    // The last message's content rides along as a preview snippet for the conversation list.
    db`
      SELECT c.id, c.title, c.surface, c.updated_at, m.content AS snippet
      FROM chat_conversations c
      LEFT JOIN LATERAL (
        SELECT content FROM chat_messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON true
      ORDER BY c.updated_at DESC
      LIMIT 30
    `,
    activeId
      ? db`
          SELECT id, role, content, tool_calls, created_at
          FROM chat_messages
          WHERE conversation_id = ${activeId}
          ORDER BY created_at
        `
      : [],
    db`
      SELECT id, target_kind, target_key, operation, statement, supersedes_text, created_at
      FROM context_corrections
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 15
    `,
  ]);

  // postgres.js returns untyped rows, so each query's shape is asserted here rather than in the
  // component, matching how the other dashboard pages hand typed data to their templates.
  return {
    conversations: conversations.map((row) => ({
      id: row.id as string,
      title: row.title as string | null,
      // Which page the conversation started on, for the badge in the list.
      surface: row.surface as string | null,
      updated_at: iso(row.updated_at),
      snippet: row.snippet as string | null,
    })),
    activeId,
    // tool_calls comes back from postgres.js as a JSON string, not an array - see $lib/jsonb.
    messages: messages.map((row) => ({
      id: row.id as string,
      role: row.role as string,
      content: row.content as string,
      tool_calls: parseJsonb<ChatToolCall[]>(row.tool_calls, []),
      created_at: iso(row.created_at),
    })),
    corrections: corrections.map((row) => ({
      id: row.id as string,
      target_kind: row.target_kind as string,
      target_key: row.target_key as string,
      operation: row.operation as string,
      statement: row.statement as string,
      supersedes_text: row.supersedes_text as string | null,
      created_at: iso(row.created_at),
    })),
  };
};

function conversationError(err: unknown) {
  if (err instanceof ConversationError) return fail(400, { error: err.message });
  throw err;
}

export const actions: Actions = {
  rename: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    if (!id) return fail(400, { error: "Missing conversation id" });

    try {
      await renameConversation(id, (form.text("title")) ?? "");
      return { ok: true };
    } catch (err) {
      return conversationError(err);
    }
  },

  delete: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    if (!id) return fail(400, { error: "Missing conversation id" });

    await deleteConversation(id);
    return { ok: true, deletedId: id };
  },
};

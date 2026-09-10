import type { PageServerLoad } from "./$types";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";

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
 * live.
 */
// postgres.js hands back timestamptz as a Date; the page only formats it, and a Date does not
// survive the serialisation boundary as one, so it is normalised here.
const iso = (value: unknown): string => new Date(value as string).toISOString();

export const load: PageServerLoad = async ({ url }) => {
  const db = sql();

  const conversations = await db`
    SELECT id, title, surface, updated_at
    FROM chat_conversations
    ORDER BY updated_at DESC
    LIMIT 30
  `;

  const requested = url.searchParams.get("c");
  const activeId = requested && /^[0-9a-f-]{36}$/i.test(requested)
    ? requested
    : (conversations[0]?.id as string | undefined) ?? null;

  const messages = activeId
    ? await db`
        SELECT id, role, content, tool_calls, created_at
        FROM chat_messages
        WHERE conversation_id = ${activeId}
        ORDER BY created_at
      `
    : [];

  const corrections = await db`
    SELECT id, target_kind, target_key, operation, statement, supersedes_text, created_at
    FROM context_corrections
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 15
  `;

  // postgres.js returns untyped rows, so each query's shape is asserted here rather than in the
  // component, matching how the other dashboard pages hand typed data to their templates.
  return {
    conversations: conversations.map((row) => ({
      id: row.id as string,
      title: row.title as string | null,
      // Which page the conversation started on, for the badge in the list.
      surface: row.surface as string | null,
      updated_at: iso(row.updated_at),
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

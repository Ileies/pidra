/**
 * `chat_conversations` writes made from the dashboard side: rename and delete. Sending a message
 * and creating a conversation go through the skills bridge (`/api/assistant/chat`), because that
 * is where the model call and the conversation's `origin`/`surface` are decided. These two are
 * dashboard-only management actions on `/chat` that never touch the model.
 */
import { sql } from "#lib/server/postgres.js";

export class ConversationError extends Error {}

function normaliseTitle(raw: string): string {
  const title = (raw ?? "").trim().slice(0, 200);
  if (!title) throw new ConversationError("A conversation needs a title.");
  return title;
}

export async function renameConversation(id: string, rawTitle: string): Promise<void> {
  const title = normaliseTitle(rawTitle);
  const [row] = await sql()`
    UPDATE chat_conversations SET title = ${title} WHERE id = ${id} RETURNING id
  `;
  if (!row) throw new ConversationError(`Conversation ${id} not found`);
}

/** Cascades to `chat_messages` (FK `ON DELETE CASCADE`). Idempotent, like every other delete in
 *  the dashboard: a replay against an already-gone row is success, not a 404. */
export async function deleteConversation(id: string): Promise<void> {
  await sql()`DELETE FROM chat_conversations WHERE id = ${id}`;
}

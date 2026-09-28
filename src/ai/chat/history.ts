import { eq } from "drizzle-orm";
import { db, chatMessages } from "../../db";
import type { ResponseInput } from "../openai";

/** History replay caps. A widget one click away from every page produces long conversations. */
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_TOOL_LOG_CHARS = 8000;

/**
 * Rebuilds the model input from the stored transcript. Only user text and assistant text are
 * replayed - reasoning items and raw function calls are not, because they are only valid within
 * the request that produced them. Past tool results travel as part of the assistant's own text
 * summary plus the tool-call log rendered below, which is enough for follow-up questions and
 * avoids replaying stale call ids.
 *
 * Capped from the end: recent turns keep their tool log, older ones lose it before they lose
 * their text.
 */
export async function buildHistory(conversationId: string): Promise<ResponseInput> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt);

  const recent = rows.slice(-MAX_HISTORY_MESSAGES);

  const logs = new Map<string, string>();
  let budget = MAX_TOOL_LOG_CHARS;
  for (const row of [...recent].reverse()) {
    const calls = row.toolCalls ?? [];
    if (calls.length === 0 || budget <= 0) continue;
    const log = `\n\n[skills used: ${calls
      .map((c) => `${c.name}(${JSON.stringify(c.arguments)}) -> ${c.status ?? "executed"}: ${(c.result ?? "").slice(0, 300)}`)
      .join(" | ")}]`;
    if (log.length > budget) continue;
    budget -= log.length;
    logs.set(row.id, log);
  }

  return recent.map((row) => ({
    role: row.role === "user" ? ("user" as const) : ("assistant" as const),
    content: `${row.content}${logs.get(row.id) ?? ""}`,
  }));
}

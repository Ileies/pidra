import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { db, chatConversations, chatMessages, type ChatToolCall } from "../../db";
import { recentCorrections } from "../../context/lookup";
import type { TurnContext } from "./context";

export async function listConversations(limit = 30) {
  return db
    .select()
    .from(chatConversations)
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

export async function getConversation(conversationId: string) {
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1);
  if (!conversation) return null;

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt);

  return { conversation, messages };
}

export async function persistAssistantTurn(
  conversationId: string,
  reply: string,
  toolCalls: ChatToolCall[],
  ctx: TurnContext,
): Promise<void> {
  await db.insert(chatMessages).values({
    conversationId,
    role: "assistant",
    content: reply,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    pageContext: ctx,
  });
  await db.update(chatConversations).set({ updatedAt: drizzleSql`now()` }).where(eq(chatConversations.id, conversationId));
}

/** Small helper for the dashboard sidebar: what has been corrected lately. */
export async function correctionsSummary() {
  return recentCorrections(20);
}

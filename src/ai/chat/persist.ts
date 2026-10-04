import { eq, sql as drizzleSql } from "drizzle-orm";
import { db, chatConversations, chatMessages, type ChatToolCall } from "../../db";
import type { TurnContext } from "./context";

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

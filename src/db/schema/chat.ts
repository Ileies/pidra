import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, jsonb, pk, updatedAt } from "./columns";

export const chatConversations = pgTable("chat_conversations", {
  id: pk(),
  title: text("title"),
  /** The surface the conversation started on - for grouping and labelling in /chat. */
  surface: text("surface"),
  origin: text("origin"), // widget | page
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** What the assistant was looking at when a turn was taken, snapshotted per message because the user navigates mid-conversation. */
export interface PageContextSnapshot {
  surface: string;
  route: string;
  digest?: string;
  focus?: { kind: string; id: string; label?: string }[];
}

export interface ChatToolCall {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status?: string;
}

export const chatMessages = pgTable("chat_messages", {
  id: pk(),
  conversationId: uuid("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull().default(""),
  /** Skill calls the assistant made on this turn, with their results, for replay and display. */
  toolCalls: jsonb("tool_calls").$type<ChatToolCall[]>(),
  /** The page the turn was taken on, as sent by the client and validated server-side. */
  pageContext: jsonb("page_context").$type<PageContextSnapshot>(),
  createdAt: createdAt(),
});

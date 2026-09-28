import { db, chatConversations, chatMessages, type ChatToolCall } from "../../db";
import { eq } from "drizzle-orm";
import { converse, type ResponseInput } from "../openai";
import { executeSkill } from "../../skills/execute";
import { normaliseContext, systemPrompt, type TurnContextInput } from "./context";
import { skillTools, SKILL_TOUCHES } from "./tools";
import { buildHistory } from "./history";
import { persistAssistantTurn } from "./persist";

// Enough for read → write → read-back on several facts in one turn, with a hard stop so a model
// that loops on a failing tool cannot run up a bill.
const MAX_TOOL_ROUNDS = 8;

export interface ChatTurn {
  conversationId: string;
  reply: string;
  toolCalls: ChatToolCall[];
  /** Stores this turn changed. Empty means the page the user is on is still current. */
  touched: string[];
}

export type TurnEvent =
  | { type: "conversation"; id: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; status: string; message: string }
  | { type: "text"; text: string }
  | { type: "done"; reply: string; toolCalls: ChatToolCall[]; touched: string[] }
  | { type: "error"; message: string };

/**
 * One user turn, emitted as events so the widget can show tool calls as they execute instead of
 * a spinner. The model call itself is not token-streamed: on the flex tier the wait is dominated
 * by queueing and tool rounds, not by token emission.
 */
export async function* streamMessage(
  userMessage: string,
  conversationId: string | undefined,
  contextInput: TurnContextInput = {},
  origin = "widget",
): AsyncGenerator<TurnEvent> {
  const text = userMessage.trim();
  if (!text) throw new Error("message is required");

  const ctx = normaliseContext(contextInput);

  let id = conversationId;
  if (id) {
    const [existing] = await db.select({ id: chatConversations.id }).from(chatConversations).where(eq(chatConversations.id, id)).limit(1);
    if (!existing) throw new Error(`no conversation ${id}`);
  } else {
    const [created] = await db
      .insert(chatConversations)
      .values({ title: text.slice(0, 80), surface: ctx.surface, origin })
      .returning({ id: chatConversations.id });
    id = created.id;
  }
  yield { type: "conversation", id };

  const history = await buildHistory(id);
  await db.insert(chatMessages).values({
    conversationId: id,
    role: "user",
    content: text,
    pageContext: ctx,
  });

  const input: ResponseInput = [...history, { role: "user", content: text }];
  const tools = await skillTools(ctx.surface);
  const toolCalls: ChatToolCall[] = [];
  const touched = new Set<string>();
  let reply = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await converse(systemPrompt(ctx), input, { tools, maxOutputTokens: 4096 });
      if (result.text) {
        reply = result.text;
        yield { type: "text", text: result.text };
      }

      if (result.functionCalls.length === 0) break;

      // The model's own items have to be replayed verbatim: `store: false` means the API holds no
      // state, so a function_call_output with no preceding function_call is rejected.
      input.push(...result.output);

      for (const call of result.functionCalls) {
        let args: Record<string, unknown> = {};

        try {
          args = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
        } catch {
          const message = `arguments were not valid JSON: ${call.argumentsJson}`;
          input.push({ type: "function_call_output", call_id: call.callId, output: message });
          toolCalls.push({ call_id: call.callId, name: call.name, arguments: {}, result: message, status: "failed" });
          yield { type: "tool_result", name: call.name, status: "failed", message };
          continue;
        }

        yield { type: "tool_call", name: call.name, arguments: args };

        const executed = await executeSkill(call.name, args, "chat", {
          surface: ctx.surface,
          conversationId: id,
        });

        if (executed.status === "executed") {
          for (const store of SKILL_TOUCHES[call.name] ?? []) touched.add(store);
        }

        input.push({
          type: "function_call_output",
          call_id: call.callId,
          output: `${executed.status}: ${executed.message}`.slice(0, 4000),
        });
        toolCalls.push({ call_id: call.callId, name: call.name, arguments: args, result: executed.message, status: executed.status });
        yield { type: "tool_result", name: call.name, status: executed.status, message: executed.message };
      }

      if (round === MAX_TOOL_ROUNDS) {
        reply = reply || "I stopped after too many tool calls in one turn. Tell me what to do next.";
        break;
      }
    }
  } catch (err) {
    // Whatever already ran has to stay visible: the transcript records the partial turn rather
    // than losing the fact that a write happened.
    const message = err instanceof Error ? err.message : String(err);
    reply = reply || `Der Durchlauf ist abgebrochen: ${message}`;
    await persistAssistantTurn(id, reply, toolCalls, ctx);
    yield { type: "error", message };
    return;
  }

  await persistAssistantTurn(id, reply, toolCalls, ctx);
  yield { type: "done", reply, toolCalls, touched: [...touched] };
}

/** The non-streaming form, for the plain JSON endpoint. Same loop, collected. */
export async function sendMessage(
  userMessage: string,
  conversationId?: string,
  contextInput: TurnContextInput = {},
  origin = "page",
): Promise<ChatTurn> {
  let id = conversationId ?? "";
  let reply = "";
  let toolCalls: ChatToolCall[] = [];
  let touched: string[] = [];

  for await (const event of streamMessage(userMessage, conversationId, contextInput, origin)) {
    if (event.type === "conversation") id = event.id;
    else if (event.type === "text") reply = event.text;
    else if (event.type === "done") {
      reply = event.reply;
      toolCalls = event.toolCalls;
      touched = event.touched;
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  return { conversationId: id, reply, toolCalls, touched };
}

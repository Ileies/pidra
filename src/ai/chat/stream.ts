import { errMessage } from "../../util/text";
import { db, chatConversations, chatMessages, type ChatToolCall } from "../../db";
import { eq } from "drizzle-orm";
import { converse, type ResponseInput } from "../openai";
import { executeSkill } from "../../skills/execute";
import { loadPromptVars } from "../../settings/store";
import { normaliseContext, systemPrompt, type TurnContextInput } from "./context";
import { skillTools, skillTouches } from "./tools";
import { buildHistory, MAX_TOOL_RESULT_CHARS } from "./history";
import { persistAssistantTurn } from "./persist";

// The assistant turn loop: converse -> run tool calls via executeSkill (surface-gated) -> repeat.
// Writes `chat_conversations` / `chat_messages` (via persist.ts); streamed by src/server/routes/chat.ts.

// Hard stop so a model looping on a failing tool cannot run up a bill.
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

type TurnContext = ReturnType<typeof normaliseContext>;

/** The conversation a turn belongs to: the one named, which must exist, or a new one titled from the message. */
async function openConversation(conversationId: string | undefined, text: string, ctx: TurnContext, origin: string): Promise<string> {
  if (conversationId) {
    const [existing] = await db.select({ id: chatConversations.id }).from(chatConversations).where(eq(chatConversations.id, conversationId)).limit(1);
    if (!existing) throw new Error(`no conversation ${conversationId}`);
    return conversationId;
  }
  const [created] = await db
    .insert(chatConversations)
    .values({ title: text.slice(0, 80), surface: ctx.surface, origin })
    .returning({ id: chatConversations.id });
  return created.id;
}

/**
 * One tool call of the model's: parsed, executed through `executeSkill` (which owns the gating and
 * the audit log), and reported as events as it goes. Returns what to feed back to the model and
 * what to record on the turn.
 */
async function* runToolCall(
  call: { callId: string; name: string; argumentsJson?: string | null },
  ctx: TurnContext,
  conversationId: string,
  touched: Set<string>,
): AsyncGenerator<TurnEvent, { output: string; record: ChatToolCall }> {
  let args: Record<string, unknown>;
  try {
    args = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
  } catch {
    const message = `arguments were not valid JSON: ${call.argumentsJson}`;
    yield { type: "tool_result", name: call.name, status: "failed", message };
    return { output: message, record: { call_id: call.callId, name: call.name, arguments: {}, result: message, status: "failed" } };
  }

  yield { type: "tool_call", name: call.name, arguments: args };

  const executed = await executeSkill(call.name, args, "chat", {
    surface: ctx.surface,
    conversationId,
    timeZone: ctx.timeZone,
  });
  if (executed.status === "executed") {
    for (const store of skillTouches(call.name)) touched.add(store);
  }

  yield { type: "tool_result", name: call.name, status: executed.status, message: executed.message };
  return {
    output: `${executed.status}: ${executed.message}`.slice(0, MAX_TOOL_RESULT_CHARS),
    record: { call_id: call.callId, name: call.name, arguments: args, result: executed.message, status: executed.status },
  };
}

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
  const id = await openConversation(conversationId, text, ctx, origin);
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
  const vars = await loadPromptVars();
  const toolCalls: ChatToolCall[] = [];
  const touched = new Set<string>();
  let reply = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await converse(systemPrompt(ctx, vars), input, { tools, maxOutputTokens: 4096 });
      if (result.text) {
        reply = result.text;
        yield { type: "text", text: result.text };
      }

      if (result.functionCalls.length === 0) break;

      // The model's own items have to be replayed verbatim: `store: false` means the API holds no
      // state, so a function_call_output with no preceding function_call is rejected.
      input.push(...result.output);

      for (const call of result.functionCalls) {
        const { output, record } = yield* runToolCall(call, ctx, id, touched);
        input.push({ type: "function_call_output", call_id: call.callId, output });
        toolCalls.push(record);
      }

      if (round === MAX_TOOL_ROUNDS) {
        reply = reply || "I stopped after too many tool calls in one turn. Tell me what to do next.";
        break;
      }
    }
  } catch (err) {
    // Whatever already ran has to stay visible: the transcript records the partial turn rather
    // than losing the fact that a write happened.
    const message = errMessage(err);
    reply = reply || `The run was interrupted: ${message}`;
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

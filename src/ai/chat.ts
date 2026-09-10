import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { db, chatConversations, chatMessages, type ChatToolCall } from "../db";
import { converse, type FunctionTool, type ResponseInput } from "./openai";
import { listSkills, type Skill } from "../skills/loader";
import { executeSkill } from "../skills/execute";
import { recentCorrections } from "../context/lookup";

/**
 * The context-revision chat: a tool-calling loop over the whole skill registry.
 *
 * Tools are derived from `listSkills()` rather than a hand-kept list, so a skill added to
 * `skills/` is usable from the chat with no change here. Every call goes through
 * `executeSkill`, which means the chat is under exactly the same risk gating and audit logging
 * as the REST bridge. See CONTEXT_REVISION_PLAN.md.
 */

// Enough for read → revise → read-back on several facts in one turn, with a hard stop so a
// model that loops on a failing tool cannot run up a bill.
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are PIDRA's context assistant. You help the user correct and extend the
long-term context that the Context Builder harvested from their email, notes, tasks and repos.
That context is injected into every morning briefing, so an error in it repeats daily until fixed.

The governing rule: harvested information is never overwritten, only adjusted and complemented.
You do not rewrite the context document or existing standing rules. \`revise_context\` records a
correction in a separate layer that outranks the harvest in every future briefing, and the wrong
text is deliberately kept alongside it.

How to work:
- Look before you write. Run \`read_context\` to find the exact wrong wording and a real
  target_key. \`read_context\` with query 'outline' lists the context document's headings.
- One fact per \`revise_context\` call. Three wrong things about a person are three calls.
- Quote the wrong text in \`supersedes\` verbatim from what \`read_context\` returned. That is how
  the briefing knows which sentence to disregard. Never invent a quote.
- Pick the operation honestly: \`amend\` when the harvest states something wrong, \`complement\`
  when it is merely incomplete, \`retract\` when a statement should simply not be believed.
- For a person the harvest got wrong, also pass \`fields\` when there is a matching entity or
  contact row, so the structured data stops disagreeing with the correction. Contacts are keyed
  by email address; a contact row is a mail-sender directory entry, not a social relationship.
- Relationship facts about family and partners belong in the document/standing-context layer,
  which is what the daily briefing actually reads for who people are.
- Confirm what you changed in one or two sentences, plainly. Do not restate the whole context.
- If the user's instruction is ambiguous about which fact or which person, ask before writing.
- Corrections are reversible with \`revert_context_revision\`. Say so when you have made one.

You have the system's other skills available too (notes, todos, calendar, search). Use them when
the user asks for something that is not a context correction.`;

function toJsonSchema(skill: Skill): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, param] of Object.entries(skill.parameters)) {
    properties[name] = { type: param.type, description: param.description ?? "" };
    if (param.required) required.push(name);
  }

  // `strict: false` below, so optional parameters can simply be omitted by the model.
  return { type: "object", properties, required, additionalProperties: false };
}

function skillTools(): FunctionTool[] {
  return listSkills().map((skill) => ({
    type: "function" as const,
    name: skill.name,
    description: `${skill.description} (risk: ${skill.risk_level})`,
    parameters: toJsonSchema(skill),
    strict: false,
  }));
}

export interface ChatTurn {
  conversationId: string;
  reply: string;
  toolCalls: ChatToolCall[];
}

/**
 * Rebuilds the model input from the stored transcript. Only user text and assistant text are
 * replayed - reasoning items and raw function calls are not, because they are only valid within
 * the request that produced them. Past tool results travel as part of the assistant's own text
 * summary plus the tool-call log rendered below, which is enough for follow-up questions and
 * avoids replaying stale call ids.
 */
async function buildHistory(conversationId: string): Promise<ResponseInput> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt);

  return rows.map((row) => {
    const calls = row.toolCalls ?? [];
    const log = calls.length > 0
      ? `\n\n[skills used: ${calls.map((c) => `${c.name}(${JSON.stringify(c.arguments)}) -> ${c.status ?? "executed"}: ${(c.result ?? "").slice(0, 300)}`).join(" | ")}]`
      : "";
    return {
      role: row.role === "user" ? ("user" as const) : ("assistant" as const),
      content: `${row.content}${log}`,
    };
  });
}

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

export async function sendMessage(userMessage: string, conversationId?: string): Promise<ChatTurn> {
  const text = userMessage.trim();
  if (!text) throw new Error("message is required");

  let id = conversationId;
  if (id) {
    const [existing] = await db.select({ id: chatConversations.id }).from(chatConversations).where(eq(chatConversations.id, id)).limit(1);
    if (!existing) throw new Error(`no conversation ${id}`);
  } else {
    const [created] = await db
      .insert(chatConversations)
      .values({ title: text.slice(0, 80) })
      .returning({ id: chatConversations.id });
    id = created.id;
  }

  const history = await buildHistory(id);
  await db.insert(chatMessages).values({ conversationId: id, role: "user", content: text });

  const input: ResponseInput = [...history, { role: "user", content: text }];
  const tools = skillTools();
  const toolCalls: ChatToolCall[] = [];
  let reply = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await converse(SYSTEM_PROMPT, input, { tools, maxOutputTokens: 4096 });
    reply = result.text;

    if (result.functionCalls.length === 0) break;

    // The model's own items have to be replayed verbatim: `store: false` means the API holds no
    // state, so a function_call_output with no preceding function_call is rejected.
    input.push(...result.output);

    for (const call of result.functionCalls) {
      let args: Record<string, unknown> = {};
      let outcome: { status: string; message: string };

      try {
        args = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
      } catch {
        outcome = { status: "failed", message: `arguments were not valid JSON: ${call.argumentsJson}` };
        input.push({ type: "function_call_output", call_id: call.callId, output: outcome.message });
        toolCalls.push({ call_id: call.callId, name: call.name, arguments: {}, result: outcome.message, status: outcome.status });
        continue;
      }

      // Provenance: a correction must point back at the conversation that produced it.
      if (call.name === "revise_context") args.conversation_id = id;

      const executed = await executeSkill(call.name, args, "chat");
      outcome = { status: executed.status, message: executed.message };

      input.push({
        type: "function_call_output",
        call_id: call.callId,
        output: `${outcome.status}: ${outcome.message}`.slice(0, 4000),
      });
      toolCalls.push({ call_id: call.callId, name: call.name, arguments: args, result: outcome.message, status: outcome.status });
    }

    if (round === MAX_TOOL_ROUNDS) {
      reply = reply || "I stopped after too many tool calls in one turn. Tell me what to do next.";
      break;
    }
  }

  await db.insert(chatMessages).values({
    conversationId: id,
    role: "assistant",
    content: reply,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
  });
  await db.update(chatConversations).set({ updatedAt: drizzleSql`now()` }).where(eq(chatConversations.id, id));

  return { conversationId: id, reply, toolCalls };
}

/** Small helper for the dashboard sidebar: what has been corrected lately. */
export async function correctionsSummary() {
  return recentCorrections(20);
}

import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { db, chatConversations, chatMessages, type ChatToolCall, type PageContextSnapshot } from "../db";
import { converse, type FunctionTool, type ResponseInput } from "./openai";
import { listSkills, type Skill } from "../skills/loader";
import { executeSkill } from "../skills/execute";
import { recentCorrections } from "../context/lookup";
import { SURFACES, resolveSurface, type Surface } from "./surfaces";

/**
 * The assistant's turn loop: a tool-calling conversation over the skill registry, scoped to the
 * dashboard page it was opened on.
 *
 * Tools come from `listSkills()` filtered by the page's surface, so a skill added to `skills/` is
 * usable with no change here, and a skill that does not belong on the current page is never even
 * offered. Every call goes through `executeSkill`, which re-checks the surface server-side and
 * owns the risk gating and the audit log - the model can invent a tool name, and the surface
 * arrives from a client.
 *
 * See ASSISTANT_PLAN.md and CONTEXT_REVISION_PLAN.md.
 */

// Enough for read → write → read-back on several facts in one turn, with a hard stop so a model
// that loops on a failing tool cannot run up a bill.
const MAX_TOOL_ROUNDS = 8;

/** History replay caps. A widget one click away from every page produces long conversations. */
const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_LOG_CHARS = 8000;

const BASE_PROMPT = `You are PIDRA's assistant, embedded in the user's own dashboard. You help them
change the system's content: notes, the harvested long-term context, entities, todos and calendar
entries. You act through skills, and the page the user is on decides which skills you have.

How to work:
- Look before you write. Read the thing you are about to change, so ids and quotes are real
  rather than guessed.
- One fact per call. Three wrong things about a person are three calls.
- Do what was asked and say what you did, in one or two plain sentences. Do not restate the whole
  note or the whole context back at the user.
- If the instruction is ambiguous about which item or which person, ask before writing.
- If something you need is not available on this page, say which page it belongs to instead of
  pretending or working around it.
- Never claim a change you did not make. A rejected or failed skill call is information the user
  needs, not something to paper over.
- Answer in the user's language, which is usually German.
- Answer in plain prose. The panel renders your text verbatim rather than as HTML, so markdown
  syntax would show up as literal asterisks.`;

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

/** Only this surface's skills, so the model cannot announce an edit it is not allowed to make. */
function skillTools(surface: Surface): FunctionTool[] {
  const allowed = new Set(SURFACES[surface].skills);
  return listSkills()
    .filter((skill) => allowed.has(skill.name))
    .map((skill) => ({
      type: "function" as const,
      name: skill.name,
      description: `${skill.description} (risk: ${skill.risk_level})`,
      parameters: toJsonSchema(skill),
      strict: false,
    }));
}

/** What the client says the user is looking at. Untrusted, so everything here is capped. */
export interface TurnContextInput {
  surface?: unknown;
  route?: string;
  digest?: string;
  focus?: { kind?: string; id?: string; label?: string }[];
}

export interface TurnContext extends PageContextSnapshot {
  surface: Surface;
}

const MAX_DIGEST_CHARS = 2000;
const MAX_FOCUS_ITEMS = 30;
const MAX_FOCUS_LABEL = 80;

export function normaliseContext(input: TurnContextInput = {}): TurnContext {
  const route = typeof input.route === "string" && input.route.startsWith("/") ? input.route : "/";

  return {
    // The route decides. A claimed surface is only ever a cross-check, never a way for a client
    // to widen its own capabilities.
    surface: resolveSurface(input.surface, route),
    route,
    digest: typeof input.digest === "string" ? input.digest.slice(0, MAX_DIGEST_CHARS) : undefined,
    focus: Array.isArray(input.focus)
      ? input.focus
          .filter((item) => item && typeof item.id === "string")
          .slice(0, MAX_FOCUS_ITEMS)
          .map((item) => ({
            kind: String(item.kind ?? "item"),
            id: String(item.id),
            label: item.label ? String(item.label).slice(0, MAX_FOCUS_LABEL) : undefined,
          }))
      : undefined,
  };
}

/**
 * The page, rendered for the model. The `focus` list is what makes "delete the second note about
 * the newsletter" work: real ids for what is actually on screen.
 */
function renderContext(ctx: TurnContext): string {
  const lines = [`The user is on ${ctx.route} (${SURFACES[ctx.surface].label}).`];
  if (ctx.digest) lines.push(ctx.digest);
  if (ctx.focus?.length) {
    lines.push("", "Visible on the page right now:");
    for (const item of ctx.focus) {
      lines.push(`- ${item.kind} ${item.id}${item.label ? `: ${item.label}` : ""}`);
    }
  }
  return lines.join("\n");
}

function systemPrompt(ctx: TurnContext): string {
  return [BASE_PROMPT, SURFACES[ctx.surface].prompt, renderContext(ctx)].join("\n\n");
}

/** Which stores a turn wrote, so the dashboard knows whether the page it is on went stale. */
const SKILL_TOUCHES: Record<string, string[]> = {
  write_note: ["notes"],
  update_note: ["notes"],
  delete_note: ["notes"],
  restore_note: ["notes"],
  revise_context: ["context", "entities"],
  revert_context_revision: ["context", "entities"],
  set_source_active: ["sources"],
  propose_prompt_version: ["prompts"],
  add_todo_item: ["todos"],
  complete_todo_item: ["todos"],
  add_calendar_event: ["calendar"],
};

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
 * Rebuilds the model input from the stored transcript. Only user text and assistant text are
 * replayed - reasoning items and raw function calls are not, because they are only valid within
 * the request that produced them. Past tool results travel as part of the assistant's own text
 * summary plus the tool-call log rendered below, which is enough for follow-up questions and
 * avoids replaying stale call ids.
 *
 * Capped from the end: recent turns keep their tool log, older ones lose it before they lose
 * their text.
 */
async function buildHistory(conversationId: string): Promise<ResponseInput> {
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
  const tools = skillTools(ctx.surface);
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

async function persistAssistantTurn(
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

/** Small helper for the dashboard sidebar: what has been corrected lately. */
export async function correctionsSummary() {
  return recentCorrections(20);
}

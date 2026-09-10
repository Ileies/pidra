import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { inArray, eq, desc, gte, and, sql as drizzleSql } from "drizzle-orm";
import { runPipeline } from "../pipeline/run";
import { db, extractions, rawItems, sourceQuality, sourceDailyScores, questionGateSessions, contacts, skillExecutions, rawItemExists, promptVersions } from "../db";
import type { GateAnswer, GateQuestion } from "../db/schema";
import { PROMPT_SECTIONS, resolveActivePrompts } from "../ai/active-prompts";
import { synthesize } from "../ai/openai";
import { DEEPEN_PROMPT } from "../ai/prompts";
import { loadSkills, listSkills } from "../skills/loader";
import { executeSkill } from "../skills/execute";
import { sendMessage, streamMessage, listConversations, getConversation, type TurnContextInput } from "../ai/chat";
import { SURFACES, SURFACES_LIST } from "../ai/surfaces";
import { listActiveCorrections, revertCorrection, CorrectionError } from "../context/corrections";
import {
  listNotes, createNote, updateNote, softDeleteNote, restoreNote, noteHistory, revertToRevision,
  NoteError, type Actor, type NoteWrite,
} from "../notes/store";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));

// --- Skills Bridge ---

app.get("/skills", (c) => c.json(listSkills().map((s) => ({
  name: s.name,
  description: s.description,
  risk_level: s.risk_level,
  parameters: s.parameters,
}))));

app.post("/skills/execute", async (c) => {
  const body = await c.req.json() as {
    skill: string;
    parameters?: Record<string, unknown>;
    triggered_by?: string;
    run_id?: string;
    authorization_level?: "auto" | "confirm";
  };

  const { skill: skillName, parameters = {}, triggered_by = "manual" } = body;
  if (!skillName) return c.json({ error: "skill is required" }, 400);

  // Risk gating and the audit log live in executeSkill, shared with the chat loop.
  const outcome = await executeSkill(skillName, parameters, triggered_by);

  switch (outcome.status) {
    case "unknown_skill":
      return c.json({ error: outcome.message }, 404);
    case "rejected":
      return c.json({ status: "rejected", reason: outcome.message }, 403);
    case "pending_confirmation":
      return c.json({ status: "pending_confirmation", message: outcome.message, execution_id: outcome.executionId }, 202);
    case "failed":
      return c.json({ status: "failed", error: outcome.message }, 500);
    default:
      return c.json({ status: "executed", result: outcome.message });
  }
});

app.get("/api/skills/executions", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db.select().from(skillExecutions).orderBy(desc(skillExecutions.createdAt)).limit(limit);
  return c.json(rows);
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

// SMS forwarding webhook - receives messages from Android SMS forwarder app.
// Expected payload: { from: string, body: string, timestamp?: number }
// Auth: X-SMS-Secret header must match SMS_WEBHOOK_SECRET env var.
app.post("/webhook/sms", async (c) => {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (secret && c.req.header("X-SMS-Secret") !== secret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json() as { from?: string; body?: string; timestamp?: number };
  const from = body.from?.trim();
  const text = body.body?.trim();
  if (!from || !text) return c.json({ error: "Missing from or body" }, 400);

  const tsMs = body.timestamp ?? Date.now();
  const receivedAt = new Date(tsMs).toISOString();
  const runDate = receivedAt.split("T")[0];
  const messageId = `sms:${from}:${tsMs}`;

  if (await rawItemExists(messageId)) return c.json({ ok: true, duplicate: true });

  await db.insert(rawItems).values({
    runDate,
    sourceType: "sms",
    sourceName: from,
    messageId,
    rawContent: `From: ${from}\n\n${text}`,
    receivedAt,
  });

  return c.json({ ok: true });
});

app.post("/api/pipeline/run", async (c) => {
  const date = new Date().toISOString().split("T")[0];
  runPipeline(date).catch(console.error);
  return c.json({ status: "started", date });
});

app.post("/api/deepen", async (c) => {
  const body = await c.req.json() as { ids: string[] };
  const idList = (body.ids ?? []).filter((id: string) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 10);
  if (idList.length === 0) return c.json({ error: "No valid IDs" }, 400);

  const rows = await db
    .select({
      id: extractions.id,
      extractedJson: extractions.extractedJson,
      sourceName: rawItems.sourceName,
      sourceType: rawItems.sourceType,
    })
    .from(extractions)
    .leftJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(inArray(extractions.id, idList));

  if (rows.length === 0) return c.json({ error: "Items not found" }, 404);

  const topJson = rows[0].extractedJson as Record<string, unknown> | null;
  const headline = String(topJson?.headline ?? "");
  const topEntities = ((topJson?.entities ?? []) as string[]).slice(0, 3).join(" ");
  const searchQuery = [headline, topEntities].filter(Boolean).join(" ").slice(0, 200);

  const webResults = await braveSearch(searchQuery);

  const userContent = JSON.stringify({
    items: rows.map((r) => ({
      source: r.sourceName,
      source_type: r.sourceType,
      ...(r.extractedJson as object ?? {}),
    })),
    web_search_results: webResults || null,
  });

  const { text } = await synthesize(DEEPEN_PROMPT, userContent);
  return c.json({ text });
});

app.get("/api/sources", async (c) => {
  const quality = await db.select().from(sourceQuality).orderBy(desc(sourceQuality.compositeScore30d));

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
  const dailyRows = await db
    .select()
    .from(sourceDailyScores)
    .where(gte(sourceDailyScores.runDate, thirtyDaysAgo))
    .orderBy(desc(sourceDailyScores.runDate));

  const dailyBySource = new Map<string, typeof dailyRows>();
  for (const row of dailyRows) {
    const arr = dailyBySource.get(row.sourceName) ?? [];
    arr.push(row);
    dailyBySource.set(row.sourceName, arr);
  }

  const sources = quality.map((q) => ({
    sourceName: q.sourceName,
    isActive: q.isActive,
    disabledAt: q.disabledAt,
    disabledReason: q.disabledReason,
    trustScore: q.trustScore,
    qualityTrend: q.qualityTrend,
    compositeScore30d: q.compositeScore30d,
    dailyScores: (dailyBySource.get(q.sourceName) ?? []).slice(0, 30),
  }));

  return c.json(sources);
});

app.patch("/api/sources/:name", async (c) => {
  const sourceName = decodeURIComponent(c.req.param("name"));
  const body = await c.req.json() as { isActive: boolean; reason?: string };

  const today = new Date().toISOString().split("T")[0];
  await db
    .insert(sourceQuality)
    .values({
      sourceName,
      isActive: body.isActive,
      disabledAt: body.isActive ? undefined : today,
      disabledReason: body.isActive ? null : (body.reason ?? null),
    })
    .onConflictDoUpdate({
      target: sourceQuality.sourceName,
      set: {
        isActive: body.isActive,
        disabledAt: body.isActive ? null : today,
        disabledReason: body.isActive ? null : (body.reason ?? null),
      },
    });

  return c.json({ ok: true, sourceName, isActive: body.isActive });
});

// GET /api/questions/pending - dashboard polls for the most recent pending gate session
app.get("/api/questions/pending", async (c) => {
  const rows = await db
    .select()
    .from(questionGateSessions)
    .where(eq(questionGateSessions.status, "pending"))
    .orderBy(desc(questionGateSessions.createdAt))
    .limit(1);

  if (rows.length === 0) return c.json({ pending: false });
  return c.json({ pending: true, session: rows[0] });
});

// POST /api/questions/:runId/answers - user submits answers from the dashboard
app.post("/api/questions/:runId/answers", async (c) => {
  const runId = c.req.param("runId");
  const body = await c.req.json() as { answers: GateAnswer[] };

  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    return c.json({ error: "answers array is required" }, 400);
  }

  const [session] = await db
    .select()
    .from(questionGateSessions)
    .where(eq(questionGateSessions.runId, runId))
    .limit(1);

  if (!session) return c.json({ error: "session not found" }, 404);
  if (session.status !== "pending") return c.json({ error: "session already resolved" }, 409);

  const now = new Date().toISOString();
  await db
    .update(questionGateSessions)
    .set({ status: "answered", answers: body.answers, answeredAt: now })
    .where(eq(questionGateSessions.runId, runId));

  // Contact learning: upsert each answered question's sender into contacts
  const questions = session.questions as GateQuestion[];
  for (const answer of body.answers) {
    if (!answer.answer?.trim()) continue;
    const question = questions.find((q) => q.id === answer.id);
    if (!question) continue;
    await db
      .insert(contacts)
      .values({
        identifier: question.from,
        relationship: answer.answer.trim(),
        firstSeen: session.runDate,
      })
      .onConflictDoUpdate({
        target: contacts.identifier,
        set: { relationship: answer.answer.trim(), updatedAt: drizzleSql`now()` },
      });
  }

  return c.json({ ok: true });
});

async function braveSearch(query: string): Promise<string> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key || !query) return "";
  try {
    const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=pd`;
    const res = await fetch(url, {
      headers: { "X-Subscription-Token": key, "Accept": "application/json" },
    });
    if (!res.ok) return "";
    const data = await res.json() as { results?: Array<{ title: string; description?: string }> };
    return (data.results ?? [])
      .map((r) => `${r.title} - ${r.description ?? ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

// --- Prompt Versions ---

app.get("/api/prompts", async (c) => {
  const rows = await db.select().from(promptVersions).orderBy(desc(promptVersions.createdAt));
  return c.json(rows);
});

// What the next run will actually use per section, DB override or code baseline. Without this
// the page shows an empty table for a system that is very much running prompts.
app.get("/api/prompts/effective", async (c) => {
  const resolved = await resolveActivePrompts();
  return c.json(PROMPT_SECTIONS.map((section) => resolved[section]));
});

app.post("/api/prompts", async (c) => {
  const body = await c.req.json() as { section: string; promptText: string; changeSummary?: string };
  const { section, promptText, changeSummary } = body;
  if (!section || !promptText) return c.json({ error: "section and promptText required" }, 400);

  const existing = await db.select({ version: promptVersions.version })
    .from(promptVersions)
    .where(eq(promptVersions.section, section))
    .orderBy(desc(promptVersions.version))
    .limit(1);

  const nextVersion = (existing[0]?.version ?? 0) + 1;

  const [row] = await db.insert(promptVersions).values({
    section,
    promptText,
    changeSummary: changeSummary ?? null,
    version: nextVersion,
    active: false,
  }).returning();

  return c.json(row, 201);
});

app.post("/api/prompts/:id/approve", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Invalid id" }, 400);

  const [target] = await db.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  if (!target) return c.json({ error: "Not found" }, 404);

  // Deactivate all versions of the same section, then activate this one
  await db.update(promptVersions).set({ active: false }).where(eq(promptVersions.section, target.section));
  await db.update(promptVersions).set({ active: true, approvedAt: new Date().toISOString() }).where(eq(promptVersions.id, id));

  return c.json({ ok: true, section: target.section, version: target.version });
});

app.delete("/api/prompts/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Invalid id" }, 400);

  const [target] = await db.select({ active: promptVersions.active }).from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.active) return c.json({ error: "Cannot delete the active prompt version" }, 409);

  await db.delete(promptVersions).where(eq(promptVersions.id, id));
  return c.json({ ok: true });
});

// --- Notes ---
//
// Writes go through `src/notes/store.ts` so the UI and the note skills share one code path and
// one revision trail. The dashboard reads notes straight from Postgres, so the page still renders
// when this bridge is down; only editing needs it.

function noteError(c: Context, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof NoteError) return c.json({ error: message }, message.includes("not found") ? 404 : 400);
  throw err;
}

/** The dashboard is the only caller, and it is the user acting. */
const USER: Actor = { by: "user" };

app.get("/api/notes", async (c) => {
  const include = c.req.query("include");
  return c.json(await listNotes({
    scope: c.req.query("scope") || undefined,
    query: c.req.query("query") || undefined,
    include: include === "deleted" || include === "all" ? include : "active",
    sort: c.req.query("sort") as "newest" | "oldest" | "edited" | undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
  }));
});

app.post("/api/notes", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { content?: string; scope?: string; expires_at?: string | null };
  try {
    return c.json(await createNote({ content: body.content ?? "", scope: body.scope, expiresAt: body.expires_at ?? null }, USER), 201);
  } catch (err) {
    return noteError(c, err);
  }
});

app.patch("/api/notes/:id", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { content?: string; scope?: string; expires_at?: string | null };
  // `expires_at` is only touched when the key is actually present: absent means "leave it",
  // null means "clear it".
  const patch: NoteWrite = {};
  if (body.content !== undefined) patch.content = body.content;
  if (body.scope !== undefined) patch.scope = body.scope;
  if ("expires_at" in body) patch.expiresAt = body.expires_at ?? null;

  try {
    return c.json(await updateNote(c.req.param("id"), patch, USER));
  } catch (err) {
    return noteError(c, err);
  }
});

app.delete("/api/notes/:id", async (c) => {
  try {
    return c.json(await softDeleteNote(c.req.param("id"), USER));
  } catch (err) {
    return noteError(c, err);
  }
});

app.post("/api/notes/:id/restore", async (c) => {
  try {
    return c.json(await restoreNote(c.req.param("id"), USER));
  } catch (err) {
    return noteError(c, err);
  }
});

app.get("/api/notes/:id/history", async (c) => {
  try {
    return c.json(await noteHistory(c.req.param("id")));
  } catch (err) {
    return noteError(c, err);
  }
});

app.post("/api/notes/revisions/:id/revert", async (c) => {
  try {
    return c.json(await revertToRevision(c.req.param("id"), USER));
  } catch (err) {
    return noteError(c, err);
  }
});

// --- Context revision chat ---

app.get("/api/chat/conversations", async (c) => c.json(await listConversations()));

app.get("/api/chat/conversations/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Invalid id" }, 400);
  const found = await getConversation(id);
  if (!found) return c.json({ error: "Not found" }, 404);
  return c.json(found);
});

interface ChatRequest {
  message?: string;
  conversation_id?: string;
  /** The dashboard page the turn was sent from. Untrusted: `normaliseContext` caps and resolves it. */
  context?: TurnContextInput;
  origin?: string;
}

function chatRequestError(body: ChatRequest): string | null {
  if (!body.message?.trim()) return "message is required";
  if (body.conversation_id && !/^[0-9a-f-]{36}$/i.test(body.conversation_id)) return "Invalid conversation_id";
  return null;
}

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => ({})) as ChatRequest;
  const invalid = chatRequestError(body);
  if (invalid) return c.json({ error: invalid }, 400);

  try {
    return c.json(await sendMessage(body.message!.trim(), body.conversation_id, body.context, body.origin ?? "page"));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// --- Floating assistant ---

/** The surface registry, so the widget renders per-page hints from one source of truth. */
app.get("/api/assistant/surfaces", (c) =>
  c.json(Object.fromEntries(
    SURFACES_LIST.map((surface) => [surface, {
      label: SURFACES[surface].label,
      hints: SURFACES[surface].hints,
      notice: SURFACES[surface].notice ?? null,
      skills: SURFACES[surface].skills,
    }]),
  )));

/**
 * The same turn loop as `/api/chat`, streamed as server-sent events. Tool calls reach the widget
 * as they execute, which is what keeps a flex-tier turn from looking like a hung spinner.
 */
app.post("/api/assistant/chat", async (c) => {
  const body = await c.req.json().catch(() => ({})) as ChatRequest;
  const invalid = chatRequestError(body);
  if (invalid) return c.json({ error: invalid }, 400);

  return streamSSE(c, async (stream) => {
    // A single model call on the flex tier can be quiet for minutes. The heartbeat keeps the
    // connection from looking dead to anything between here and the browser; the client ignores
    // frames with no known type.
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
    }, 15_000);

    try {
      for await (const event of streamMessage(body.message!.trim(), body.conversation_id, body.context, body.origin ?? "widget")) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

// --- Context corrections ---

app.get("/api/context/corrections", async (c) => c.json(await listActiveCorrections()));

app.post("/api/context/corrections/:id/revert", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Invalid id" }, 400);
  try {
    return c.json({ ok: true, message: await revertCorrection(id) });
  } catch (err) {
    if (err instanceof CorrectionError) return c.json({ error: err.message }, 409);
    throw err;
  }
});

loadSkills().catch(console.error);

export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  // Bun closes idle connections after 10 seconds by default, which cut the assistant's event
  // stream in half: a flex-tier model call goes quiet for far longer than that between tool
  // calls. 0 disables the timeout; the stream ends when the turn does.
  idleTimeout: 0,
  fetch: app.fetch,
};

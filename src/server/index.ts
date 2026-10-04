import { isUuid, isDateKey } from "../util/ids";
import { utcDay } from "../util/time";
import { errMessage } from "../util/text";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { inArray, eq, desc } from "drizzle-orm";
import { runPipeline } from "../pipeline/run";
import { smsSecretAuthorized } from "./sms-auth";
import { db, extractions, rawItems, rawItemExists, promptVersions } from "../db";
import { answerQuestion, dismissQuestion, getAnsweredQuestion, reopenQuestion, QuestionError } from "../questions/store";
import { processAnswer } from "../questions/process-answer";
import { renderPromptText } from "../ai/active-prompts";
import { synthesize } from "../ai/openai";
import { braveSearch } from "../search/brave";
import { DEEPEN_PROMPT } from "../ai/prompts";
import { executeSkill, resolvePendingSkill } from "../skills/execute";
import { listEffectiveSkills, setSkillEnabled, SkillToggleError } from "../skills/overrides";
import { sendMessage, streamMessage, type TurnContextInput } from "../ai/chat";
import { SURFACES, SURFACES_LIST } from "../ai/surfaces";
import { audioManifest, chapterAudio, AudioError } from "../audio/store";
import { ActionError, dismissAction, restoreAction, runAction } from "../actions/store";
import { recordCorrection, revertCorrection, CorrectionError, type Operation, type TargetKind } from "../context/corrections";
import {
  listNotes, createNote, updateNote, softDeleteNote, restoreNote, noteHistory, revertToRevision,
  wasUpdatedSince, NoteError, type Actor, type NoteWrite,
} from "../notes/store";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));

// --- Skills Bridge ---

app.get("/skills", async (c) => c.json(await listEffectiveSkills()));

app.patch("/skills/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be a boolean" }, 400);

  try {
    return c.json(await setSkillEnabled(name, body.enabled));
  } catch (err) {
    if (err instanceof SkillToggleError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

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

// The other half of the high-risk queue. `executeSkill` parks a high-risk call as `pending` and
// says it is queued on /skills; this is what /skills calls to finish the decision.
app.post("/api/skills/executions/:id/:decision", async (c) => {
  const decision = c.req.param("decision");
  if (decision !== "confirm" && decision !== "reject") {
    return c.json({ error: "decision must be confirm or reject" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const outcome = await resolvePendingSkill(c.req.param("id"), decision, body.reason);

  switch (outcome.status) {
    case "unknown_skill":
      return c.json({ error: outcome.message }, 404);
    case "rejected":
      return c.json({ status: "rejected", reason: outcome.message });
    case "failed":
      return c.json({ status: "failed", error: outcome.message }, 500);
    default:
      return c.json({ status: "executed", result: outcome.message });
  }
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

// Listening to a report. The chapters and their text come from the stored report; a request names
// only a date and a chapter key, so it can never make the server speak text of its own choosing.
const KEY_PARAM = /^[0-9a-f]{16}$/;

app.get("/api/report-audio/:date", async (c) => {
  const date = c.req.param("date");
  if (!isDateKey(date)) return c.json({ error: "Invalid date" }, 400);
  try {
    return c.json(await audioManifest(date));
  } catch (err) {
    if (err instanceof AudioError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// POST because it can cost money (a chapter not yet spoken); a cached chapter is a plain read.
app.post("/api/report-audio/:date/:key", async (c) => {
  const { date, key } = c.req.param();
  if (!isDateKey(date) || !KEY_PARAM.test(key)) return c.json({ error: "Invalid chapter" }, 400);
  try {
    const { audio, durationMs } = await chapterAudio(date, key);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "X-Audio-Duration-Ms": String(durationMs),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AudioError) return c.json({ error: err.message }, err.status);
    console.error("report audio failed:", err);
    return c.json({ error: "The voice could not be generated. Try again." }, 502);
  }
});

// SMS forwarding webhook - receives messages from Android SMS forwarder app.
// Expected payload: { from: string, body: string, timestamp?: number }
// Auth: X-SMS-Secret header must match SMS_WEBHOOK_SECRET; with the variable unset every request is rejected.
app.post("/webhook/sms", async (c) => {
  if (!smsSecretAuthorized(process.env.SMS_WEBHOOK_SECRET, c.req.header("X-SMS-Secret"))) {
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
  const date = utcDay();
  runPipeline(date).catch(console.error);
  return c.json({ status: "started", date });
});

app.post("/api/deepen", async (c) => {
  const body = await c.req.json() as { ids: string[] };
  const idList = (body.ids ?? []).filter((id: string) => isUuid(id)).slice(0, 10);
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

  const webResults = searchQuery
    ? (await braveSearch(searchQuery, 5, { kind: "news" })).results.map((r) => `${r.title} - ${r.description}` ).join("\n")
    : "";

  const userContent = JSON.stringify({
    items: rows.map((r) => ({
      source: r.sourceName,
      source_type: r.sourceType,
      ...(r.extractedJson as object ?? {}),
    })),
    web_search_results: webResults || null,
  });

  const { text } = await synthesize(await renderPromptText(DEEPEN_PROMPT), userContent);
  return c.json({ text });
});

// POST /api/questions/:id/:op - one question at a time from /questions: answer, dismiss, reopen.
// `src/questions/store.ts` is the only writer of the queue; the dashboard only proxies.
app.post("/api/questions/:id/:op", async (c) => {
  const id = c.req.param("id");
  const op = c.req.param("op");
  if (!isUuid(id)) return c.json({ error: "Invalid id" }, 400);

  try {
    if (op === "answer") {
      const body = await c.req.json().catch(() => ({})) as { answer?: unknown };
      const question = await answerQuestion(id, typeof body.answer === "string" ? body.answer : "");
      // Not awaited: acting on the answer is a tool-calling turn that can take a minute. Its result
      // is recorded on the question (`answer_status`) and shown on /questions/closed.
      void processAnswer(question.id);
      return c.json({ id: question.id, status: question.status });
    }
    if (op === "reprocess") {
      const question = await getAnsweredQuestion(id);
      if (question.answerStatus === "done") return c.json({ error: "The answer was already acted on" }, 409);
      void processAnswer(id);
      return c.json({ id, status: question.status });
    }
    if (op === "dismiss") {
      const question = await dismissQuestion(id);
      return c.json({ id: question.id, status: question.status });
    }
    if (op === "reopen") {
      const question = await reopenQuestion(id);
      return c.json({ id: question.id, status: question.status });
    }
    return c.json({ error: "op must be answer, dismiss, reopen or reprocess" }, 400);
  } catch (err) {
    if (err instanceof QuestionError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// --- Prompt Versions ---

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
  if (!isUuid(id)) return c.json({ error: "Invalid id" }, 400);

  const [target] = await db.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  if (!target) return c.json({ error: "Not found" }, 404);

  // One transaction: a failure between the two writes must not leave the section with no active version.
  await db.transaction(async (tx) => {
    await tx.update(promptVersions).set({ active: false }).where(eq(promptVersions.section, target.section));
    await tx.update(promptVersions).set({ active: true, approvedAt: new Date().toISOString() }).where(eq(promptVersions.id, id));
  });

  return c.json({ ok: true, section: target.section, version: target.version });
});

app.delete("/api/prompts/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Invalid id" }, 400);

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
  if (err instanceof NoteError) return c.json({ error: err.message }, err.status);
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
  const body = await c.req.json().catch(() => ({})) as { id?: string; content?: string; scope?: string; expires_at?: string | null };
  try {
    return c.json(
      await createNote(
        { id: body.id, content: body.content ?? "", scope: body.scope, expiresAt: body.expires_at ?? null },
        USER,
      ),
      201,
    );
  } catch (err) {
    return noteError(c, err);
  }
});

app.patch("/api/notes/:id", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    content?: string; scope?: string; expires_at?: string | null; base_updated_at?: string | null;
  };
  // `expires_at` is only touched when the key is actually present: absent means "leave it",
  // null means "clear it".
  const patch: NoteWrite = {};
  if (body.content !== undefined) patch.content = body.content;
  if (body.scope !== undefined) patch.scope = body.scope;
  if ("expires_at" in body) patch.expiresAt = body.expires_at ?? null;

  try {
    // Read before write, not atomic with it - acceptable for one user. `base_updated_at` only
    // ever arrives from the offline outbox; a live UI edit never sends it,
    // so `_conflict` is always false for those and costs nothing extra.
    const conflict = "base_updated_at" in body
      ? await wasUpdatedSince(c.req.param("id"), body.base_updated_at ?? null)
      : false;
    const note = await updateNote(c.req.param("id"), patch, USER);
    return c.json({ ...note, _conflict: conflict });
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

// --- Quick actions ---
//
// The report's one-tap buttons (`src/actions/`). The dashboard is the only caller and it is the
// owner tapping, so the skill runs attributed to them. `run` is safe to repeat: a second tap on a
// done action answers with the first result instead of adding the event again.

const ACTION_OPS = {
  run: async (id: string) => runAction(id),
  dismiss: async (id: string) => ({ action: await dismissAction(id), message: "Dismissed" }),
  restore: async (id: string) => ({ action: await restoreAction(id), message: "Restored" }),
} as const;

app.post("/api/actions/:id/:op", async (c) => {
  const id = c.req.param("id");
  const op = c.req.param("op");
  if (!isUuid(id)) return c.json({ error: "Invalid id" }, 400);
  if (!(op in ACTION_OPS)) return c.json({ error: "op must be run, dismiss or restore" }, 400);

  try {
    const { action, message } = await ACTION_OPS[op as keyof typeof ACTION_OPS](id);
    return c.json({ id: action.id, status: action.status, message });
  } catch (err) {
    if (err instanceof ActionError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// --- Context revision chat ---

interface ChatRequest {
  message?: string;
  conversation_id?: string;
  /** The dashboard page the turn was sent from. Untrusted: `normaliseContext` caps and resolves it. */
  context?: TurnContextInput;
  origin?: string;
}

function chatRequestError(body: ChatRequest): string | null {
  if (!body.message?.trim()) return "message is required";
  if (body.conversation_id && !isUuid(body.conversation_id)) return "Invalid conversation_id";
  return null;
}

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => ({})) as ChatRequest;
  const invalid = chatRequestError(body);
  if (invalid) return c.json({ error: invalid }, 400);

  try {
    return c.json(await sendMessage(body.message!.trim(), body.conversation_id, body.context, body.origin ?? "page"));
  } catch (err) {
    return c.json({ error: errMessage(err) }, 500);
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
        data: JSON.stringify({ type: "error", message: errMessage(err) }),
      });
    } finally {
      clearInterval(heartbeat);
    }
  });
});

// --- Context corrections ---

/**
 * Record a correction directly, for the dashboard's own editing surfaces (D7).
 *
 * `/contacts` lets the owner fix a name or a relationship inline, and that has to behave exactly
 * as the `revise_context` skill does: the row merge is field-level, the pre-merge row is
 * snapshotted into `previous_state`, and the row is locked against a re-seed. So it goes through
 * `recordCorrection`, the single writer, rather than the dashboard reaching for the table.
 */
app.post("/api/context/corrections", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    target_kind?: string;
    target_key?: string;
    operation?: string;
    statement?: string;
    supersedes?: string | null;
    rationale?: string | null;
    fields?: Record<string, unknown> | null;
    source?: string;
  };

  try {
    const result = await recordCorrection({
      targetKind: String(body.target_kind ?? "") as TargetKind,
      targetKey: String(body.target_key ?? ""),
      operation: String(body.operation ?? "amend") as Operation,
      statement: String(body.statement ?? ""),
      supersedesText: body.supersedes ?? null,
      rationale: body.rationale ?? null,
      fields: body.fields ?? null,
      source: body.source ?? "dashboard",
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CorrectionError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

app.post("/api/context/corrections/:id/revert", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Invalid id" }, 400);
  try {
    return c.json({ ok: true, message: await revertCorrection(id) });
  } catch (err) {
    if (err instanceof CorrectionError) return c.json({ error: err.message }, 409);
    throw err;
  }
});


export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  // Loopback only. Bun would otherwise bind 0.0.0.0, and the bridge executes skills - the
  // firewall already blocks the port, but this is the rule stated in CLAUDE.md and it should
  // not depend on a firewall rule staying correct. The dashboard reaches it server-side.
  hostname: process.env.SKILLS_BRIDGE_HOST ?? "127.0.0.1",
  // Bun closes idle connections after 10 seconds by default, which cut the assistant's event
  // stream in half: a flex-tier model call goes quiet for far longer than that between tool
  // calls. 0 disables the timeout; the stream ends when the turn does.
  idleTimeout: 0,
  fetch: app.fetch,
};

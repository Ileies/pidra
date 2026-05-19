import { Hono } from "hono";
import { cors } from "hono/cors";
import { inArray, eq, desc, gte, and, sql as drizzleSql } from "drizzle-orm";
import { runPipeline } from "../pipeline/run";
import { db, extractions, rawItems, sourceQuality, sourceDailyScores, questionGateSessions, contacts, rawItemExists } from "../db";
import type { GateAnswer, GateQuestion } from "../db/schema";
import { synthesize } from "../ai/openai";
import { DEEPEN_PROMPT } from "../ai/prompts";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

// SMS forwarding webhook — receives messages from Android SMS forwarder app.
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

// GET /api/questions/pending — dashboard polls for the most recent pending gate session
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

// POST /api/questions/:runId/answers — user submits answers from the dashboard
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
      .map((r) => `${r.title} — ${r.description ?? ""}`)
      .join("\n");
  } catch {
    return "";
  }
}

export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  fetch: app.fetch,
};

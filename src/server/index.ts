import { Hono } from "hono";
import { cors } from "hono/cors";
import { inArray, eq, desc, gte, and } from "drizzle-orm";
import { runPipeline } from "../pipeline/run";
import { db, extractions, rawItems, sourceQuality, sourceDailyScores } from "../db";
import { synthesize } from "../ai/openai";
import { DEEPEN_PROMPT } from "../ai/prompts";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

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

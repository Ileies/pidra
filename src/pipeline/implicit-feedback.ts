import { google } from "googleapis";
import { googleAuth } from "../ingest/google-client";
import { db, extractions, rawItems, feedbackEvents, pipelineRuns } from "../db";
import { eq, and, sql } from "drizzle-orm";

function extractKeywords(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const j = json as Record<string, unknown>;
  const kw = new Set<string>();

  for (const e of (j.entities ?? []) as string[]) {
    const w = e.toLowerCase().trim();
    if (w.length > 2) kw.add(w);
  }
  for (const t of (j.topic_tags ?? []) as string[]) {
    const w = t.toLowerCase().trim();
    if (w.length > 2) kw.add(w);
  }
  // Significant words from the headline (length > 4, skip common stop words)
  const STOP = new Set(["that", "this", "with", "from", "have", "will", "been", "were", "they", "their"]);
  if (typeof j.headline === "string") {
    for (const w of j.headline.toLowerCase().split(/\W+/)) {
      if (w.length > 4 && !STOP.has(w)) kw.add(w);
    }
  }

  return [...kw];
}

export async function runImplicitFeedback(runDate: string): Promise<void> {
  console.log(`[ImplicitFeedback] Checking calendar/todo overlap for ${runDate}`);

  // When the day's briefing started is the lower bound for "newly added" events/tasks. Midnight
  // UTC when no run is recorded for the day.
  const [run] = await db
    .select({ startedAt: sql<string | null>`to_char(min(${pipelineRuns.startedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.runDate, runDate));
  const updatedMin = new Date(run?.startedAt ?? `${runDate}T00:00:00Z`);

  // Load today's newsletter extractions
  const rows = await db
    .select({ id: extractions.id, extractedJson: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  if (rows.length === 0) return;

  // Build keyword list per extraction, skip items with no keywords
  const items = rows
    .map((r) => ({ id: r.id, keywords: extractKeywords(r.extractedJson) }))
    .filter((r) => r.keywords.length > 0);

  // Skip extractions that already have a downstream_action event
  const existing = await db
    .select({ extractionId: feedbackEvents.extractionId })
    .from(feedbackEvents)
    .where(eq(feedbackEvents.eventType, "downstream_action"));
  const alreadyFed = new Set(existing.map((r) => r.extractionId));

  const auth = googleAuth();
  const since = updatedMin.toISOString();

  // What was added since today's pipeline run. A failed fetch is a warning, not the end of the other.
  const [calTexts, todoTexts] = await Promise.all([
    (async () => {
      const res = await google.calendar({ version: "v3", auth }).events.list({
        calendarId: "primary",
        updatedMin: since,
        maxResults: 50,
        singleEvents: true,
      });
      return (res.data.items ?? []).map((ev) => [ev.summary, ev.description].filter(Boolean).join(" ").toLowerCase());
    })().catch((err) => {
      console.warn("[ImplicitFeedback] Calendar fetch failed:", err);
      return [] as string[];
    }),
    (async () => {
      const tasks = google.tasks({ version: "v1", auth });
      const texts: string[] = [];
      for (const list of (await tasks.tasklists.list({ maxResults: 20 })).data.items ?? []) {
        if (!list.id) continue;
        const resp = await tasks.tasks.list({ tasklist: list.id, updatedMin: since, showCompleted: false, maxResults: 100 });
        for (const task of resp.data.items ?? []) texts.push([task.title, task.notes].filter(Boolean).join(" ").toLowerCase());
      }
      return texts;
    })().catch((err) => {
      console.warn("[ImplicitFeedback] Tasks fetch failed:", err);
      return [] as string[];
    }),
  ]);

  if (calTexts.length === 0 && todoTexts.length === 0) {
    console.log("[ImplicitFeedback] No new calendar events or tasks found");
    return;
  }

  // The first source an item matches decides its signal: a calendar event (5) outranks a to-do (4).
  const sources: [string[], number][] = [[calTexts, 5], [todoTexts, 4]];
  let written = 0;
  for (const { id, keywords } of items) {
    if (alreadyFed.has(id)) continue;
    const match = sources.find(([texts]) => texts.some((text) => keywords.some((k) => text.includes(k))));
    if (!match) continue;
    await db.insert(feedbackEvents).values({ extractionId: id, eventType: "downstream_action", signalValue: match[1] });
    written++;
  }

  console.log(`[ImplicitFeedback] Wrote ${written} downstream_action event(s) from ${calTexts.length} cal / ${todoTexts.length} task entries`);
}

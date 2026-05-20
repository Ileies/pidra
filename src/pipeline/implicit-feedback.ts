import { google } from "googleapis";
import { db, extractions, rawItems, feedbackEvents } from "../db";
import { eq, and } from "drizzle-orm";

function createAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

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

  // Today's pipeline run time acts as the lower bound for "newly added" events/tasks
  const [h, m] = (process.env.PIPELINE_RUN_TIME ?? "06:30").split(":").map(Number);
  const updatedMin = new Date();
  updatedMin.setHours(h, m, 0, 0);

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

  const auth = createAuthClient();

  // Fetch recently updated calendar events (since today's pipeline run)
  const calTexts: string[] = [];
  try {
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.list({
      calendarId: "primary",
      updatedMin: updatedMin.toISOString(),
      maxResults: 50,
      singleEvents: true,
    });
    for (const ev of res.data.items ?? []) {
      calTexts.push([ev.summary, ev.description].filter(Boolean).join(" ").toLowerCase());
    }
  } catch (err) {
    console.warn("[ImplicitFeedback] Calendar fetch failed:", err);
  }

  // Fetch recently updated tasks (since today's pipeline run)
  const todoTexts: string[] = [];
  try {
    const tasks = google.tasks({ version: "v1", auth });
    const lists = (await tasks.tasklists.list({ maxResults: 20 })).data.items ?? [];
    for (const list of lists) {
      if (!list.id) continue;
      const resp = await tasks.tasks.list({
        tasklist: list.id,
        updatedMin: updatedMin.toISOString(),
        showCompleted: false,
        maxResults: 100,
      });
      for (const task of resp.data.items ?? []) {
        todoTexts.push([task.title, task.notes].filter(Boolean).join(" ").toLowerCase());
      }
    }
  } catch (err) {
    console.warn("[ImplicitFeedback] Tasks fetch failed:", err);
  }

  if (calTexts.length === 0 && todoTexts.length === 0) {
    console.log("[ImplicitFeedback] No new calendar events or tasks found");
    return;
  }

  let written = 0;
  for (const { id, keywords } of items) {
    if (alreadyFed.has(id)) continue;

    // Calendar match → signal 5
    const calMatch = calTexts.some((text) => keywords.some((k) => text.includes(k)));
    if (calMatch) {
      await db.insert(feedbackEvents).values({ extractionId: id, eventType: "downstream_action", signalValue: 5 });
      written++;
      continue;
    }

    // Todo match → signal 4
    const todoMatch = todoTexts.some((text) => keywords.some((k) => text.includes(k)));
    if (todoMatch) {
      await db.insert(feedbackEvents).values({ extractionId: id, eventType: "downstream_action", signalValue: 4 });
      written++;
    }
  }

  console.log(`[ImplicitFeedback] Wrote ${written} downstream_action event(s) from ${calTexts.length} cal / ${todoTexts.length} task entries`);
}

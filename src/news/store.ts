/** What the news desk run reads from and writes to the database, so `run.ts` is only the orchestration. */

import { addDays } from "../util/time";
import { and, eq, gte, inArray, lt, max } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { selectNotes } from "../notes/select";
import { DESKS, NEWS_SOURCE_TYPE, deskMessageId, deskSource, type Desk, type DeskId, type NewsWindow } from "./config";
import type { SearchEvidence } from "./research";
import { storyFromStored, toExtraction, type Candidate, type DeskStory, type NewsExtraction, type ReportedStory } from "./validate";

/** How many days of what the reader was already told each desk is shown, and dedup compares against. */
const REPORTED_LOOKBACK_DAYS = 3;

export interface DeskAnswer {
  desk: Desk;
  stories: DeskStory[];
  queries: string[];
  sources: string[];
  evidence: SearchEvidence[];
  searchCalls: number;
  aiCalls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  prompt: { section: string; version: number | null };
  model: string;
}

/**
 * The delivery's `raw_content`: a header block the dashboard's `parseTitle` already reads, then
 * the whole answer, queries and consulted URLs included, so a surprising story can be traced back
 * to the searches that produced it.
 */
function deliveryContent(answer: DeskAnswer, window: NewsWindow): string {
  const header = [
    `Title: ${answer.desk.label}`,
    `Source: ${deskSource(answer.desk.id)}`,
    `Window: ${window.start} to ${window.end}`,
  ].join("\n");
  const body = JSON.stringify({
    desk: answer.desk.id,
    model: answer.model,
    prompt: answer.prompt,
    window,
    durationMs: answer.durationMs,
    searchCalls: answer.searchCalls,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
    queries: answer.queries,
    consulted: answer.sources,
    searches: answer.evidence,
    stories: answer.stories,
  });
  return `${header}\n\n${body}`;
}

/** The window an earlier run of the same day recorded, so every desk of one date shares one. */
function storedWindow(rawContent: string | null): NewsWindow | null {
  if (!rawContent) return null;
  try {
    const body = JSON.parse(rawContent.slice(rawContent.indexOf("\n\n") + 2)) as { window?: NewsWindow };
    return body.window?.start && body.window?.end ? body.window : null;
  } catch {
    return null;
  }
}

/** `received_at` (= the window end) of the newest earlier desk delivery; null on the very first run. */
export async function lastScanEnd(runDate: string): Promise<Date | null> {
  const [row] = await db
    .select({ end: max(rawItems.receivedAt) })
    .from(rawItems)
    .where(and(eq(rawItems.sourceType, NEWS_SOURCE_TYPE), lt(rawItems.runDate, runDate)));
  return row?.end ? new Date(row.end) : null;
}

/** What the reader actually saw on the last few days: cited in a report, not merely researched. */
export async function recentlyReported(runDate: string): Promise<ReportedStory[]> {
  const rows = await db
    .select({ runDate: extractions.runDate, json: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(
      eq(rawItems.sourceType, NEWS_SOURCE_TYPE),
      eq(extractions.includedInReport, true),
      gte(extractions.runDate, addDays(runDate, -REPORTED_LOOKBACK_DAYS)),
      lt(extractions.runDate, runDate),
    ));

  return rows.flatMap((row) => {
    const json = row.json as Partial<NewsExtraction> | null;
    if (!json?.headline) return [];
    return [{ date: row.runDate, headline: json.headline, urls: (json.sources ?? []).map((s) => s.url) }];
  });
}

/**
 * The contents of the live `intel` notes (expired and deleted ones skipped). Callers treat index 0
 * as the first priority, so the order is oldest note first (`id` breaks ties for a stable order).
 */
export async function priorities(runDate: string): Promise<string[]> {
  return (await selectNotes("news", runDate)).map((r) => r.content);
}

export interface ReusedDesks {
  /** The window an earlier run recorded, if any of the reused deliveries carries one. */
  window: NewsWindow | null;
  /** Desks already stored for this date. */
  desks: Set<DeskId>;
  /** Their stories, so they take part in the duplicate check. */
  candidates: Candidate[];
  /** Stories stored per reused desk. */
  counts: Map<DeskId, number>;
}

/**
 * The desks this date already holds, keyed on the delivery's `message_id`. Everything they stored
 * takes part in the duplicate check, so a desk re-run after a failure cannot repeat a story another
 * desk stored this morning.
 */
export async function loadReusedDesks(desks: Desk[], runDate: string): Promise<ReusedDesks> {
  const deliveries = await db
    .select({ id: rawItems.id, sourceName: rawItems.sourceName, rawContent: rawItems.rawContent })
    .from(rawItems)
    .where(inArray(rawItems.messageId, desks.map((desk) => deskMessageId(runDate, desk.id))));

  const deskOf = new Map(desks.map((desk) => [deskSource(desk.id), desk.id]));
  const deskByDelivery = new Map(deliveries.flatMap((d) => (deskOf.has(d.sourceName ?? "") ? [[d.id, deskOf.get(d.sourceName!)!] as const] : [])));
  const reused: ReusedDesks = {
    window: deliveries.map((d) => storedWindow(d.rawContent)).find((w) => w !== null) ?? null,
    desks: new Set(deskByDelivery.values()),
    candidates: [],
    counts: new Map([...deskByDelivery.values()].map((id) => [id, 0])),
  };
  if (deliveries.length === 0) return reused;

  const rows = await db
    .select({ json: extractions.extractedJson, rawItemId: extractions.rawItemId })
    .from(extractions)
    .where(inArray(extractions.rawItemId, deliveries.map((d) => d.id)));

  for (const row of rows) {
    const deskId = deskByDelivery.get(row.rawItemId!);
    if (deskId) reused.counts.set(deskId, (reused.counts.get(deskId) ?? 0) + 1);
    const json = row.json as NewsExtraction | null;
    if (!json?.headline) continue;
    reused.candidates.push({
      desk: json.desk,
      deskOrder: DESKS.findIndex((d) => d.id === json.desk),
      story: storyFromStored(json),
      validation: json.validation,
      stored: true,
    });
  }
  return reused;
}

/** Stores one desk's delivery and its stories. Returns how many stories were stored. */
export async function persist(answer: DeskAnswer, candidates: Candidate[], runDate: string, window: NewsWindow): Promise<number> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .insert(rawItems)
      .values({
        runDate,
        sourceType: NEWS_SOURCE_TYPE,
        sourceName: deskSource(answer.desk.id),
        messageId: deskMessageId(runDate, answer.desk.id),
        rawContent: deliveryContent(answer, window),
        receivedAt: window.end,
      })
      .onConflictDoNothing({ target: rawItems.messageId })
      .returning({ id: rawItems.id });

    // A concurrent run stored this desk first. Its stories are the record; ours are dropped whole
    // rather than interleaved with them.
    if (!delivery) return 0;

    for (const { story, validation } of candidates) {
      await tx.insert(extractions).values({
        rawItemId: delivery.id,
        runDate,
        extractedJson: toExtraction(answer.desk.id, story, validation),
        // The desk's significance, on its own scale. Phase 3 overwrites effective relevance with
        // the gate's figure, which for a news story is the same number: no trust score applies.
        relevanceScore: story.significance,
        effectiveRelevance: story.significance,
        novelty: story.status === "update" ? "continuation" : "new",
        includedInReport: false,
        aiFailed: false,
      });
    }
    return candidates.length;
  });
}

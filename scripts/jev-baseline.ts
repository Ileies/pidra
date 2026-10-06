/**
 * Export one completed morning's public-news and newsletter candidate trail for local review.
 * Usage: bun run scripts/jev-baseline.ts YYYY-MM-DD --output /private/path/DATE.json
 * The output can contain paid newsletter claims. Keep it outside version control.
 * Read-only against the DB (pipeline_runs, run_candidates, raw_items, extractions, feedback_events, ingest_drops);
 * writes one JSON file (mode 0600, refuses to overwrite) and refuses a path inside this repo.
 * Run as `bun run jev:baseline`; a manual tool for the Jev ranking evaluation (src/evaluation/baseline.ts).
 */
import { isDateKey } from "../src/util/ids";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { loadRssFeeds } from "../src/config/rss-feeds";
import { loadNewsletterConfig } from "../src/config/newsletter-sources";
import { db, dailyReports, extractions, feedbackEvents, ingestDrops, pipelineRuns, rawItems, runCandidates } from "../src/db";
import { candidateOutcome, sourceFailures } from "../src/evaluation/baseline";

const [date, flag, outputPath] = Bun.argv.slice(2);
if (!isDateKey(date ?? "") || flag !== "--output" || !outputPath) {
  throw new Error("Usage: bun run scripts/jev-baseline.ts YYYY-MM-DD --output /private/path/DATE.json");
}
if (!isAbsolute(outputPath)) throw new Error("--output must be an absolute path outside this repository");
const relativePath = relative(resolve(import.meta.dir, ".."), outputPath);
if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
  throw new Error("--output must be outside this repository because the snapshot can contain private claims");
}

const [run] = await db.select().from(pipelineRuns)
  .where(eq(pipelineRuns.runDate, date)).orderBy(desc(pipelineRuns.startedAt)).limit(1);
if (!run || run.status !== "completed") throw new Error(`No latest completed pipeline run for ${date}`);

const [report] = await db.select({ id: dailyReports.id }).from(dailyReports)
  .where(eq(dailyReports.reportDate, date)).limit(1);
if (!report) throw new Error(`No report for ${date}`);

const deliveries = await db.select({
  id: rawItems.id,
  sourceType: rawItems.sourceType,
  sourceName: rawItems.sourceName,
  receivedAt: rawItems.receivedAt,
}).from(rawItems).where(and(
  eq(rawItems.runDate, date),
  inArray(rawItems.sourceType, ["newsletter", "web_news"]),
)).orderBy(asc(rawItems.sourceType), asc(rawItems.sourceName), asc(rawItems.id));

const extracted = deliveries.length > 0 ? await db.select({
  id: extractions.id,
  rawItemId: extractions.rawItemId,
  extractedJson: extractions.extractedJson,
  relevanceScore: extractions.relevanceScore,
  effectiveRelevance: extractions.effectiveRelevance,
  novelty: extractions.novelty,
  aiFailed: extractions.aiFailed,
  gatePassed: extractions.gatePassed,
  gateReason: extractions.gateReason,
  gateDetail: extractions.gateDetail,
  synthesisHandoff: extractions.synthesisHandoff,
  synthesisOrder: extractions.synthesisOrder,
  includedInReport: extractions.includedInReport,
}).from(extractions).where(inArray(extractions.rawItemId, deliveries.map((row) => row.id)))
  .orderBy(asc(extractions.id)) : [];

const extractionIds = extracted.map((row) => row.id);
const feedback = extractionIds.length > 0
  ? await db.select({
      extractionId: feedbackEvents.extractionId,
      eventType: feedbackEvents.eventType,
      signalValue: feedbackEvents.signalValue,
      createdAt: feedbackEvents.createdAt,
    }).from(feedbackEvents).where(inArray(feedbackEvents.extractionId, extractionIds))
      .orderBy(asc(feedbackEvents.createdAt), asc(feedbackEvents.id))
  : [];

const drops = await db.select({
  id: ingestDrops.id,
  sourceType: ingestDrops.sourceType,
  sourceName: ingestDrops.sourceName,
  reason: ingestDrops.reason,
  receivedAt: ingestDrops.receivedAt,
}).from(ingestDrops).where(and(
  eq(ingestDrops.runDate, date),
  eq(ingestDrops.sourceType, "newsletter"),
)).orderBy(asc(ingestDrops.id));

// A run recorded after Phase 6 has its verdicts frozen in `run_candidates`; text and feedback still
// come from the live extraction when it exists. Older runs fall back to the live verdicts.
const ledger = await db.select().from(runCandidates).where(eq(runCandidates.runId, run.id)).orderBy(asc(runCandidates.extractionId));
const liveById = new Map(extracted.map((row) => [row.id, row]));
type Candidate = Omit<(typeof extracted)[number], "extractedJson"> & { extractedJson: unknown; newsEditorOrder: number | null };
const rows: Candidate[] = ledger.length > 0
  ? ledger.map((row) => ({
      id: row.extractionId,
      rawItemId: row.rawItemId,
      extractedJson: liveById.get(row.extractionId)?.extractedJson ?? null,
      relevanceScore: row.relevanceScore,
      effectiveRelevance: row.effectiveRelevance,
      novelty: row.novelty,
      aiFailed: row.aiFailed,
      gatePassed: row.gatePassed,
      gateReason: row.gateReason,
      gateDetail: row.gateDetail,
      synthesisHandoff: row.synthesisHandoff,
      synthesisOrder: row.synthesisOrder,
      includedInReport: row.includedInReport,
      newsEditorOrder: row.newsEditorOrder,
    }))
  : extracted.map((row) => ({ ...row, newsEditorOrder: null }));
const byDelivery = new Map<string, Candidate[]>();
for (const row of rows) {
  if (!row.rawItemId) continue;
  const list = byDelivery.get(row.rawItemId) ?? [];
  list.push(row);
  byDelivery.set(row.rawItemId, list);
}
const byExtraction = new Map<string, typeof feedback>();
for (const row of feedback) {
  if (!row.extractionId) continue;
  const list = byExtraction.get(row.extractionId) ?? [];
  list.push(row);
  byExtraction.set(row.extractionId, list);
}
const [newsletterConfig, feeds] = await Promise.all([loadNewsletterConfig(), loadRssFeeds()]);
// The generic Substack sender has no source name; Netzpolitik.org is configured for sender
// recognition but explicitly declined from the 32-source briefing roster.
const configuredNewsletters = [...new Set([
  ...feeds.map((feed) => feed.sourceName),
  ...Object.values(newsletterConfig.domains),
  ...Object.values(newsletterConfig.addresses),
])].filter((name) => name !== "" && name !== "Netzpolitik.org").sort();
const deliveredNewsletters = new Set(deliveries.filter((row) => row.sourceType === "newsletter").map((row) => row.sourceName));

const snapshot = {
  formatVersion: 2,
  // "ledger": verdicts frozen after Phase 6; "live": rebuilt from today's extraction rows (older runs).
  verdictSource: ledger.length > 0 ? "ledger" : "live",
  runDate: date,
  runId: run.id,
  reportId: report.id,
  exportedAt: new Date().toISOString(),
  // No delivery is an observation, not a failure: many sources have a weekly or irregular cadence.
  newslettersWithoutDelivery: configuredNewsletters.filter((name) => !deliveredNewsletters.has(name)),
  sourceFailures: sourceFailures(run.stepErrors ?? []),
  ingestDrops: drops,
  deliveries: deliveries.map((delivery) => ({
    ...delivery,
    candidates: (byDelivery.get(delivery.id) ?? [])
      .sort((a, b) => (a.synthesisOrder ?? Number.MAX_SAFE_INTEGER) - (b.synthesisOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
      .map((row) => {
        const data = row.extractedJson as Record<string, unknown> | null;
        return {
          extractionId: row.id,
          headline: typeof data?.headline === "string" ? data.headline : null,
          keyClaim: typeof data?.key_claim === "string" ? data.key_claim : null,
          topic: typeof data?.topic === "string" ? data.topic : null,
          topicTags: Array.isArray(data?.topic_tags) ? data.topic_tags : [],
          validation: delivery.sourceType === "web_news" ? data?.validation ?? null : null,
          relevanceScore: row.relevanceScore,
          effectiveRelevance: row.effectiveRelevance,
          novelty: row.novelty,
          gatePassed: row.gatePassed,
          gateReason: row.gateReason,
          gateDetail: row.gateDetail,
          synthesisHandoff: row.synthesisHandoff,
          synthesisOrder: row.synthesisOrder,
          newsEditorOrder: row.newsEditorOrder,
          includedInReport: row.includedInReport,
          outcome: candidateOutcome({ ...row, sourceType: delivery.sourceType as "newsletter" | "web_news" }),
          feedback: byExtraction.get(row.id) ?? [],
        };
      }),
  })),
};

const output = await open(outputPath, "wx", 0o600);
try {
  await output.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`);
} finally {
  await output.close();
}
console.log(`Wrote ${snapshot.deliveries.length} deliveries to ${outputPath}`);

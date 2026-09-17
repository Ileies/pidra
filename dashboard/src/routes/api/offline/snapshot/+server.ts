import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";
import { version } from "$app/env";
import { collectRefIds, renderReport, resolveValidIds } from "#lib/server/reports.js";
import { loadExtractions } from "#lib/server/extractions.js";
import { loadHarvestDocument } from "#lib/server/contextBuilder.js";
import type { ReportJson } from "#lib/report/types.js";

/**
 * The one endpoint the offline mirror pulls from (OFFLINE_PLAN.md §5). Assembly, not new SQL
 * semantics: every query here reuses the same server helpers the live pages call, so the mirror
 * never renders a report, a harvest document or a rule differently than the online path would.
 *
 * Simplified from the original design on purpose: no `since` delta and no explicit `deleted` list.
 * At the measured size (a 60-day window is 2-3 MB, OFFLINE_PLAN.md §4) a full pull on every sync is
 * cheap, and `sync.ts` does a full replace of each store against whatever this returns - which
 * handles deletions for free, since a row missing from the response is pruned from the mirror
 * without the server needing to track a tombstone list. Add `since` later if the archive ever grows
 * past the point where a full pull is worth avoiding; nothing else here would need to change shape.
 *
 * Never in the payload: `raw_items.raw_content` (loadExtractions with withRawContent: false, same
 * as the inline expansion), and anything from chat_messages, skill_executions, push_subscriptions
 * or pipeline_runs.step_errors.
 */

const MIRROR_DAYS = 60;

interface MirroredReport {
  id: string; // == date
  date: string;
  report: {
    shortSummary: string | null;
    itemCount: number | null;
    itemsIncluded: number | null;
    itemsFiltered: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
    aiCalls: number | null;
    webSearchesRun: number | null;
    createdAt: string | null;
  } | null;
  pipelineRun: {
    status: "running" | "completed" | "failed";
    failedStep: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  } | null;
  structured: ReturnType<typeof renderReport>["structured"];
  reportHtml: string | null;
  ratings: Record<string, string>;
}

async function buildReports(): Promise<{ reports: MirroredReport[]; extractionIds: string[] }> {
  const db = sql();

  const dateRows = await db`SELECT report_date::text AS report_date FROM daily_reports ORDER BY report_date DESC LIMIT ${MIRROR_DAYS}`;
  const dates = dateRows.map((row) => row.report_date as string);
  if (dates.length === 0) return { reports: [], extractionIds: [] };

  const [reportRows, runRows] = await Promise.all([
    db`
      SELECT report_date::text AS report_date, full_report, report_json, short_summary,
             item_count, items_included, items_filtered, tokens_in, tokens_out, ai_calls,
             web_searches_run, created_at
      FROM daily_reports
      WHERE report_date::text = ANY(${dates})
    `,
    db`
      SELECT DISTINCT ON (run_date) run_date::text AS run_date, status, failed_step,
             started_at, completed_at, duration_ms
      FROM pipeline_runs
      WHERE run_date::text = ANY(${dates})
      ORDER BY run_date, started_at DESC
    `,
  ]);

  const runByDate = new Map(runRows.map((row) => [row.run_date as string, row]));

  const parsed = reportRows.map((row) => {
    const date = row.report_date as string;
    const fullReport = (row.full_report as string | null) ?? null;
    const reportJson = parseJsonb<ReportJson | null>(row.report_json, null);
    return { row, date, fullReport, reportJson };
  });

  const candidateIds = [...new Set(parsed.flatMap((p) => collectRefIds(p.reportJson, p.fullReport)))];
  const validIds = await resolveValidIds(candidateIds);

  const reports: MirroredReport[] = parsed.map(({ row, date, fullReport, reportJson }) => {
    const { structured, reportHtml } = renderReport({ fullReport, reportJson, date, validIds });
    const run = runByDate.get(date);
    return {
      id: date,
      date,
      report: {
        shortSummary: (row.short_summary as string | null) ?? null,
        itemCount: (row.item_count as number | null) ?? null,
        itemsIncluded: (row.items_included as number | null) ?? null,
        itemsFiltered: (row.items_filtered as number | null) ?? null,
        tokensIn: (row.tokens_in as number | null) ?? null,
        tokensOut: (row.tokens_out as number | null) ?? null,
        aiCalls: (row.ai_calls as number | null) ?? null,
        webSearchesRun: (row.web_searches_run as number | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
      },
      pipelineRun: run
        ? {
            status: run.status as "running" | "completed" | "failed",
            failedStep: (run.failed_step as string | null) ?? null,
            startedAt: (run.started_at as string | null) ?? null,
            completedAt: (run.completed_at as string | null) ?? null,
            durationMs: (run.duration_ms as number | null) ?? null,
          }
        : null,
      structured,
      reportHtml,
      ratings: {},
    };
  });

  return { reports, extractionIds: [...validIds] };
}

async function attachRatings(reports: MirroredReport[]): Promise<void> {
  const allIds = [...new Set(reports.flatMap((r) => [...refIdsOf(r)]))];
  if (allIds.length === 0) return;
  const rows = await sql()`
    SELECT extraction_id::text AS extraction_id, event_type FROM feedback_events
    WHERE extraction_id::text = ANY(${allIds})
    AND event_type IN ('explicit_plus', 'explicit_minus')
  `;
  const ratings = new Map(rows.map((row) => [row.extraction_id as string, row.event_type as string]));
  for (const report of reports) {
    for (const id of refIdsOf(report)) {
      const rating = ratings.get(id);
      if (rating) report.ratings[id] = rating;
    }
  }
}

function refIdsOf(report: MirroredReport): string[] {
  if (report.structured) {
    return [
      ...report.structured.personal.flatMap((g) => g.entries.flatMap((e) => e.refIds)),
      ...report.structured.intel.flatMap((g) => g.entries.flatMap((e) => e.refIds)),
      ...report.structured.alsoNoted.flatMap((e) => e.refIds),
    ];
  }
  return [];
}

async function buildNotes() {
  const rows = await sql()`
    SELECT
      n.id, n.content, n.scope, n.created_at, n.updated_at, n.expires_at,
      n.created_by, n.updated_by, n.deleted_at,
      (SELECT count(*) FROM note_revisions r WHERE r.note_id = n.id)::int AS revision_count
    FROM notes n
    ORDER BY n.created_at DESC
    LIMIT 500
  `;
  return rows.map((row) => ({
    id: row.id as string,
    content: row.content as string,
    scope: row.scope as string,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    updated_by: (row.updated_by as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    revision_count: row.revision_count as number,
  }));
}

async function buildRules() {
  const rows = await sql()`SELECT id, key, value, source, updated_at FROM standing_context ORDER BY source, key`;
  return rows.map((row) => ({
    id: row.id as string,
    key: row.key as string,
    value: row.value as string,
    source: (row.source as string | null) ?? "context_builder",
    updatedAt: (row.updated_at as string | null) ?? null,
  }));
}

async function buildCorrections() {
  const rows = await sql()`
    SELECT id, target_kind, target_key, operation, statement, supersedes_text, rationale, source, created_at
    FROM context_corrections
    WHERE status = 'active'
    ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    target_kind: row.target_kind as string,
    target_key: row.target_key as string,
    operation: row.operation as string,
    statement: row.statement as string,
    supersedes_text: (row.supersedes_text as string | null) ?? null,
    rationale: (row.rationale as string | null) ?? null,
    source: row.source as string,
    created_at: row.created_at as string,
  }));
}

async function buildContextCounts() {
  const [counts] = await sql()`
    SELECT
      (SELECT count(*) FROM contacts)::int                        AS contacts,
      (SELECT count(*) FROM entities)::int                        AS entities,
      (SELECT count(*) FROM standing_context)::int                AS standing_context,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'email')::int                              AS indexed_email,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'keep')::int                               AS indexed_keep
  `;
  return counts as { contacts: number; entities: number; standing_context: number; indexed_email: number; indexed_keep: number };
}

export const GET = async () => {
  const [{ reports, extractionIds }, notes, rules, corrections, counts, harvest] = await Promise.all([
    buildReports(),
    buildNotes(),
    buildRules(),
    buildCorrections(),
    buildContextCounts(),
    loadHarvestDocument(),
  ]);

  await attachRatings(reports);

  const extractions = extractionIds.length > 0 ? await loadExtractions(extractionIds, { withRawContent: false }) : [];

  return new Response(
    JSON.stringify({
      version,
      generatedAt: new Date().toISOString(),
      stores: {
        reports,
        extractions,
        notes,
        rules,
        corrections,
        contextDoc: {
          id: "current",
          run: harvest.run,
          doc: harvest.doc,
          docError: harvest.docError,
          skipped: harvest.skipped,
          // Same rows as stores.rules/stores.corrections - the /context-builder page shows both
          // alongside the harvest, so its mirror entry carries its own copy rather than the page
          // having to reach into two other stores to reassemble what it needs.
          standing: rules,
          corrections,
          counts,
        },
      },
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
};

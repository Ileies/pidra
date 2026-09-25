import type { RequestHandler } from "./$types";
import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";
import { bodyFor, currentSnapshot, MIRROR_DAYS, requestedEtags, type SnapshotStores } from "#lib/server/snapshotCache.js";
import { collectRefIds, renderReport, resolveValidIds } from "#lib/server/reports.js";
import { loadExtractions } from "#lib/server/extractions.js";
import { loadHarvestDocument } from "#lib/server/contextBuilder.js";
import { ingestFailures, withoutDetail, type IngestFailure, type StepAttempt } from "#lib/pipeline.js";
import type { ReportJson } from "#lib/report/types.js";

/**
 * The one endpoint the offline mirror pulls from (OFFLINE_PLAN.md §5). Assembly, not new SQL
 * semantics: every query here reuses the same server helpers the live pages call, so the mirror
 * never renders a report, a harvest document or a rule differently than the online path would.
 *
 * What goes over the wire is decided by `#lib/server/snapshotCache.ts`: a `304` when the client's
 * ETag is still current, a delta of the rows that changed since a version this process built
 * recently, or the whole thing. Every answer lists all ids per store, so deletions reach the mirror
 * without a tombstone list: a row missing from `ids` is pruned. The builders below do not know
 * about any of that; they assemble the full window, and the cache decides how much of it to send.
 *
 * Never in the payload: `raw_items.raw_content` (loadExtractions with withRawContent: false, same
 * as the inline expansion), and anything from chat_messages, skill_executions, push_subscriptions
 * or pipeline_runs.step_errors.
 *
 * The one thing derived from `step_errors` is `ingestFailures`, and it is not an exception to that
 * rule: `withoutDetail` reduces each Phase 1 failure to a source name and one of four fixed words
 * before it is put in the payload, so no error text crosses. It is derived here rather than in the
 * page because this is the choke point - the report page reads only the mirror, so a consumer
 * cannot reach past this to the raw column even if it tried.
 */

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
  /** Sources that never delivered on the run behind this report. Source and kind only. */
  ingestFailures: IngestFailure[];
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
    // The newest run per date, and only that one. A date can carry several attempts, but the
    // report on the page is what the last one produced, so its failures are the ones that explain
    // what is and is not in the text. An earlier attempt that could not reach a mailbox the last
    // one then read fine is history, and `/runs` is where history lives.
    db`
      SELECT DISTINCT ON (run_date) run_date::text AS run_date, status, failed_step,
             started_at, completed_at, duration_ms, step_errors
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
      // `withoutDetail` is the boundary: the raw attempt text stays on the server, the source and
      // the kind of failure cross.
      ingestFailures: withoutDetail(
        ingestFailures(parseJsonb<StepAttempt[]>(run?.step_errors, [])),
      ),
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
      ...(report.structured.news ?? []).flatMap((g) => g.entries.flatMap((e) => e.refIds)),
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

async function assemble(): Promise<SnapshotStores> {
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

  const contextDoc = {
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
  };

  // `contextDoc` is a one-row store, so every store has the same shape and the cache can hash and
  // diff them alike.
  return { reports, extractions, notes, rules, corrections, contextDoc: [contextDoc] };
}

export const GET: RequestHandler = async ({ request }) => {
  const built = await currentSnapshot(assemble);
  // `no-store` keeps the browser's HTTP cache out of it: `sync.ts` sends `If-None-Match` itself
  // and needs to see the 304, which a cache that answered on its behalf would turn into a 200.
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: `"${built.etag}"` };
  const known = requestedEtags(request.headers.get("if-none-match"));
  if (known.includes(built.etag)) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(bodyFor(built, known)), { headers });
};

import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { MIRROR_DAYS, type SnapshotStores } from "#lib/server/snapshotCache.js";
import { collectRefIds, renderReport, resolveValidIds } from "#lib/server/reports.js";
import { loadExtractions } from "#lib/server/extractions.js";
import { loadHarvestDocument } from "#lib/server/contextHarvest.js";
import { reportNotificationKey } from "#lib/server/notifications.js";
import { ingestFailures, withoutDetail, type StepAttempt } from "#lib/pipeline.js";
import { entriesOf, type ActionPreview, type ActionStatus, type QuickAction, type ReportJson } from "#lib/report/types.js";
import type {
  MirroredAppearance,
  MirroredContact,
  MirroredCorrection,
  MirroredEntity,
  MirroredReport,
  MirroredTopic,
} from "#lib/mirror/types.js";
import type { NoteRow } from "#lib/notes/api.js";
import type { MirroredContextDoc } from "#lib/offline/repo.js";

/**
 * Assembles the full offline snapshot (`assemble()`, one array of rows per mirror store; cached and
 * diffed by `snapshotCache.ts`, served by `/api/offline/snapshot`). Row types: lib/mirror/types.ts;
 * the client mirror stores are `MIRROR_STORES` in `lib/offline/db.ts`, so a new store needs all
 * three, plus the fingerprint in `snapshotCache.ts`. Every query reuses the helpers the live pages
 * call, so the mirror never renders differently from the online path.
 *
 * Never in the payload: `raw_items.raw_content` (`withRawContent: false`), chat_messages,
 * skill_executions, push_subscriptions, or pipeline_runs.step_errors. The only thing derived from
 * `step_errors` is `ingestFailures`, reduced by `withoutDetail` to a source name and a fixed kind, so
 * no error text crosses. This is the choke point: the report page reads only the mirror.
 */

async function buildReports(): Promise<{ reports: MirroredReport[]; extractionIds: string[] }> {
  const db = sql();

  const dateRows = await db`SELECT report_date::text AS report_date FROM daily_reports ORDER BY report_date DESC LIMIT ${MIRROR_DAYS}`;
  const dates = dateRows.map((row) => row.report_date as string);
  if (dates.length === 0) return { reports: [], extractionIds: [] };

  const [reportRows, runRows, actionRows, readRows] = await Promise.all([
    db`
      SELECT report_date::text AS report_date, full_report, report_json, short_summary,
             item_count, items_included, items_filtered, tokens_in, tokens_out, ai_calls,
             web_searches_run, created_at
      FROM daily_reports
      WHERE report_date::text = ANY(${dates})
    `,
    // Newest run per date only: the report is what the last attempt produced, so only its
    // failures explain it (earlier attempts are history, shown on `/runs`).
    db`
      SELECT DISTINCT ON (run_date) run_date::text AS run_date, status, failed_step,
             started_at, completed_at, duration_ms, step_errors
      FROM pipeline_runs
      WHERE run_date::text = ANY(${dates})
      ORDER BY run_date, started_at DESC
    `,
    // No `status_detail`: on a failed action it is an error message, which stays on the server
    // like `step_errors` does.
    db`
      SELECT id, run_date::text AS run_date, status, preview, reason, source_extraction_ids::text[] AS source_ids
      FROM report_actions
      WHERE run_date::text = ANY(${dates}) AND status IN ('proposed', 'running', 'done', 'failed', 'queued')
      ORDER BY created_at, id
    `,
    db`
      SELECT substring(notification_key from 8) AS report_date, read_at
      FROM notification_reads
      WHERE notification_key = ANY(${dates.map(reportNotificationKey)})
    `,
  ]);

  const readAtByDate = new Map(readRows.map((row) => [row.report_date as string, new Date(row.read_at as string).toISOString()]));
  const runByDate = new Map(runRows.map((row) => [row.run_date as string, row]));
  const actionsByDate = new Map<string, QuickAction[]>();
  for (const row of actionRows) {
    const date = row.run_date as string;
    actionsByDate.set(date, [
      ...(actionsByDate.get(date) ?? []),
      {
        id: row.id as string,
        status: row.status as ActionStatus,
        preview: parseJsonb<ActionPreview>(row.preview, { kind: "add_todo", title: "", due: null, notes: null }),
        reason: (row.reason as string | null) ?? null,
        sourceIds: (row.source_ids as string[] | null) ?? [],
      },
    ]);
  }

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
      readAt: readAtByDate.get(date) ?? null,
      actions: actionsByDate.get(date) ?? [],
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
  return report.structured ? entriesOf(report.structured).flatMap((e) => e.refIds) : [];
}

// Queries below alias columns to match the mirror types (snake_case where the type is snake_case,
// camelCase where camelCase) so rows go in as they come out; `coalesce` supplies defaults.

async function buildNotes() {
  return sql()<NoteRow[]>`
    SELECT
      n.id, n.content, n.scope, n.created_at, n.updated_at, n.expires_at,
      n.created_by, n.updated_by, n.deleted_at, n.source_key,
      (SELECT count(*) FROM note_revisions r WHERE r.note_id = n.id)::int AS revision_count
    FROM notes n
    ORDER BY n.created_at DESC
    LIMIT 500
  `;
}

async function buildCorrections() {
  return sql()<MirroredCorrection[]>`
    SELECT id, target_kind, target_key, operation, statement, supersedes_text, rationale, source, created_at
    FROM context_corrections
    WHERE status = 'active'
    ORDER BY created_at DESC
  `;
}

async function buildContextCounts() {
  const [counts] = await sql()<MirroredContextDoc["counts"][]>`
    SELECT
      (SELECT count(*) FROM contacts WHERE removed_at IS NULL)::int AS contacts,
      (SELECT count(*) FROM entities)::int                        AS entities,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'email')::int                              AS indexed_email,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'keep')::int                               AS indexed_keep
  `;
  return counts;
}

// Reference tables are mirrored whole (well under 100 kB on 2026-09-25, slow-moving); appearances
// grow per report day, so they are bounded to the report window like extractions.

async function buildEntities() {
  return sql()<MirroredEntity[]>`
    SELECT id, name, coalesce(aliases, '{}') AS aliases, type, domain, summary,
           first_seen::text AS "firstSeen", last_mentioned::text AS "lastMentioned",
           coalesce(mention_count, 0) AS "mentionCount", coalesce(status, 'active') AS status,
           coalesce(importance, 'normal') AS importance, coalesce(locked, false) AS locked
    FROM entities
  `;
}

async function buildEntityAppearances() {
  return sql()<MirroredAppearance[]>`
    SELECT id, entity_id AS "entityId", report_date::text AS "reportDate",
           context_snippet AS "contextSnippet", relevance_score AS "relevanceScore"
    FROM entity_appearances
    WHERE report_date >= (
      SELECT min(report_date) FROM (SELECT report_date FROM daily_reports ORDER BY report_date DESC LIMIT ${MIRROR_DAYS}) win
    )
  `;
}

async function buildContacts() {
  return sql()<MirroredContact[]>`
    SELECT id, identifier, name, relationship, coalesce(priority, 'normal') AS priority,
           context_notes AS "contextNotes", first_seen::text AS "firstSeen", updated_at AS "updatedAt",
           coalesce(locked, false) AS locked, coalesce(email_count, 0) AS "emailCount"
    FROM contacts
    WHERE removed_at IS NULL
  `;
}

async function buildTopics() {
  return sql()<MirroredTopic[]>`
    SELECT id, headline, domain, running_summary AS "runningSummary", first_seen::text AS "firstSeen",
           last_updated::text AS "lastUpdated", coalesce(status, 'active') AS status,
           coalesce(update_count, 1) AS "updateCount", coalesce(sources, '{}') AS sources
    FROM active_topics
  `;
}

export async function assemble(): Promise<SnapshotStores> {
  const [
    { reports, extractionIds },
    notes,
    corrections,
    counts,
    harvest,
    entities,
    entityAppearances,
    contacts,
    topics,
  ] = await Promise.all([
    buildReports(),
    buildNotes(),
    buildCorrections(),
    buildContextCounts(),
    loadHarvestDocument(),
    buildEntities(),
    buildEntityAppearances(),
    buildContacts(),
    buildTopics(),
  ]);

  await attachRatings(reports);

  const extractions = extractionIds.length > 0 ? await loadExtractions(extractionIds, { withRawContent: false }) : [];

  const contextDoc = {
    id: "current",
    run: harvest.run,
    doc: harvest.doc,
    docError: harvest.docError,
    skipped: harvest.skipped,
    // Same rows as the `corrections` store; the page reads one entry instead of two stores.
    corrections,
    counts,
  };

  // `contextDoc` is a one-row store so every store is `Keyed[]` and diffs alike.
  return {
    reports,
    extractions,
    notes,
    corrections,
    contextDoc: [contextDoc],
    entities,
    entityAppearances,
    contacts,
    topics,
  };
}

import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { MIRROR_DAYS, type SnapshotStores } from "#lib/server/snapshotCache.js";
import { collectRefIds, renderReport, resolveValidIds } from "#lib/server/reports.js";
import { loadExtractions } from "#lib/server/extractions.js";
import { loadHarvestDocument } from "#lib/server/contextHarvest.js";
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
 * Assembles the full offline snapshot. Assembly, not new SQL semantics: every query here reuses
 * the same server helpers the live pages call, so the mirror never renders a report, a harvest
 * document or a rule differently than the online path would.
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

async function buildReports(): Promise<{ reports: MirroredReport[]; extractionIds: string[] }> {
  const db = sql();

  const dateRows = await db`SELECT report_date::text AS report_date FROM daily_reports ORDER BY report_date DESC LIMIT ${MIRROR_DAYS}`;
  const dates = dateRows.map((row) => row.report_date as string);
  if (dates.length === 0) return { reports: [], extractionIds: [] };

  const [reportRows, runRows, actionRows] = await Promise.all([
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
    // No `status_detail`: on a failed action it is an error message, which stays on the server
    // like `step_errors` does.
    db`
      SELECT id, run_date::text AS run_date, status, preview, reason, source_extraction_ids::text[] AS source_ids
      FROM report_actions
      WHERE run_date::text = ANY(${dates}) AND status IN ('proposed', 'running', 'done', 'failed', 'queued')
      ORDER BY created_at, id
    `,
  ]);

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

// The queries below name their columns as the mirror does (snake_case where the type is, camelCase
// where it is), so a row goes into the snapshot as it came out. Defaults live in `coalesce`, which
// is where a null becomes a value; a column that is nullable in the type is left null.

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

// --- the reference tables ---
//
// Mirrored whole: 447 entities, 14 contacts and 84 topics came to well under 100 kB of row text
// on 2026-09-25, and all of them move slowly. The fields the pages show, which here is nearly the
// whole row. Appearances are the one set that grows per report day, so they are bounded to the
// report window, like the extractions.

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
    // Same rows as stores.corrections - the /context-builder page shows them alongside the
    // harvest, so its mirror entry carries its own copy rather than the page having to reach
    // into another store to reassemble what it needs.
    corrections,
    counts,
  };

  // `contextDoc` is a one-row store, so every store has the same shape and the cache can hash and
  // diff them alike.
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

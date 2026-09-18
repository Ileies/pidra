/**
 * The read API Tier A pages use (OFFLINE_PLAN.md §3). Every function tries a fresh sync first and
 * then always reads the mirror - so the answer is identical in shape whether the pull succeeded or
 * not, and the caller only has to look at `source` to know which. Never written to directly by a
 * page: a page calls `repo`, and mutates only through `outbox` (landing in O3). One writer for the
 * mirror, mirroring how `src/notes/store.ts` is the one writer for `notes` one layer in.
 */

import * as db from "./db.js";
import { pull, getLastSyncedAt } from "./sync.js";
import type { RenderedReport } from "#lib/server/reports.js";
import type { ExtractedJson } from "#lib/server/extractions.js";
import type { HarvestDoc, HarvestRun } from "#lib/server/contextBuilder.js";
import type { NoteRow as MirroredNote } from "#lib/notes/api.js";
import type { IngestFailure, StepAttempt } from "#lib/pipeline.js";

export type Source = "network" | "mirror";

export interface Result<T> {
  data: T;
  source: Source;
  syncedAt: string | null;
}

async function withMirror<T>(read: () => Promise<T>): Promise<Result<T>> {
  const outcome = await pull();
  const data = await read();
  const syncedAt = await getLastSyncedAt();
  return { data, source: outcome === "synced" ? "network" : "mirror", syncedAt };
}

export interface MirroredReport {
  id: string;
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
    /** Never mirrored (OFFLINE_PLAN.md §4: attempt stacks can quote raw source content), so this
     *  is always empty offline. `ErrorCard`'s `attempts` prop already defaults to `[]`. */
    stepErrors: StepAttempt[];
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  } | null;
  /**
   * Which sources never delivered on the run behind this report - the warning above the briefing.
   * Derived from `step_errors` at the snapshot endpoint and stripped to a source name and a kind
   * there, so this carries the fact without carrying the error text the mirror must not hold.
   */
  ingestFailures: IngestFailure[];
  structured: RenderedReport | null;
  reportHtml: string | null;
  ratings: Record<string, string>;
}

export async function report(date: string): Promise<Result<MirroredReport | null>> {
  return withMirror(async () => (await db.get<MirroredReport>("reports", date)) ?? null);
}

/** The dates of every mirrored report, newest first - what `/` resolves to when it cannot reach
 *  today's, and what a report page uses for its prev/next steppers. */
export async function reportDates(): Promise<string[]> {
  const rows = await db.getAll<MirroredReport>("reports");
  return rows.map((r) => r.date).sort((a, b) => b.localeCompare(a));
}

export async function newestMirroredDate(): Promise<string | null> {
  const dates = await reportDates();
  return dates[0] ?? null;
}

export interface MirroredExtraction {
  id: string;
  sourceName: string | null;
  sourceType: string;
  receivedAt: string | null;
  rawContent: null;
  sender: string | null;
  receiver: string | null;
  novelty: string | null;
  relevanceScore: number | null;
  effectiveRelevance: number | null;
  rating: string | null;
  extracted: ExtractedJson | null;
}

export async function extractionsFor(ids: string[]): Promise<Result<MirroredExtraction[]>> {
  return withMirror(async () => {
    const all = await Promise.all(ids.map((id) => db.get<MirroredExtraction>("extractions", id)));
    // Same order as requested, same as loadExtractions' effective-relevance ordering would give for
    // a handful of ids; the detail page does not depend on a specific sort beyond "the ones asked for".
    return all.filter((item): item is MirroredExtraction => !!item);
  });
}

export interface NotesFilter {
  scope: string;
  query: string;
  sort: "newest" | "oldest" | "edited";
  view: "active" | "deleted" | "all";
}

export async function notes(filter: NotesFilter): Promise<Result<{ notes: MirroredNote[]; counts: { active: number; deleted: number } }>> {
  return withMirror(async () => {
    const all = await db.getAll<MirroredNote>("notes");
    const counts = {
      active: all.filter((n) => !n.deleted_at).length,
      deleted: all.filter((n) => !!n.deleted_at).length,
    };

    const query = filter.query.trim().toLowerCase();
    let filtered = all.filter((n) => {
      if (filter.scope && n.scope !== filter.scope) return false;
      if (query && !n.content.toLowerCase().includes(query)) return false;
      if (filter.view === "deleted") return !!n.deleted_at;
      if (filter.view === "all") return true;
      return !n.deleted_at;
    });

    filtered = filtered.sort((a, b) => {
      if (filter.sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (filter.sort === "edited") return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
      return b.created_at.localeCompare(a.created_at);
    });

    return { notes: filtered.slice(0, 200), counts };
  });
}

export interface MirroredRule {
  id: string;
  key: string;
  value: string;
  source: string;
  updatedAt: string | null;
}

export async function rules(): Promise<Result<MirroredRule[]>> {
  return withMirror(async () => {
    const rows = await db.getAll<MirroredRule>("rules");
    return rows.sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key));
  });
}

export interface MirroredCorrection {
  id: string;
  target_kind: string;
  target_key: string;
  operation: string;
  statement: string;
  supersedes_text: string | null;
  rationale: string | null;
  source: string;
  created_at: string;
}

export interface MirroredContextDoc {
  id: "current";
  run: HarvestRun | null;
  doc: HarvestDoc | null;
  docError: string | null;
  skipped: { startedAt: string; mode: string; reason: string }[];
  standing: MirroredRule[];
  corrections: MirroredCorrection[];
  counts: { contacts: number; entities: number; standing_context: number; indexed_email: number; indexed_keep: number };
}

const EMPTY_CONTEXT_DOC: MirroredContextDoc = {
  id: "current",
  run: null,
  doc: null,
  docError: null,
  skipped: [],
  standing: [],
  corrections: [],
  counts: { contacts: 0, entities: 0, standing_context: 0, indexed_email: 0, indexed_keep: 0 },
};

export async function contextDoc(): Promise<Result<MirroredContextDoc>> {
  return withMirror(async () => (await db.get<MirroredContextDoc>("contextDoc", "current")) ?? EMPTY_CONTEXT_DOC);
}

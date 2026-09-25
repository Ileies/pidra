/**
 * The read API Tier A pages use (OFFLINE_PLAN.md §3). Local-first for real since H2 (§14.3): every
 * read answers from the mirror at once and starts a background `sync()`, which is throttled and
 * single-flight, so no load ever waits on the network. When that sync changes a store, the loads
 * that read it re-run by themselves: each read takes the load's `depends` and registers the stores
 * it touched (`deps.ts`).
 *
 * The first version awaited a full pull before every read, which made "local-first" local-last:
 * two full downloads in series on a cold start, one on every day step, preload and keystroke in the
 * notes search, and up to 32 s of timers before an offline start read the mirror at all.
 *
 * An empty mirror (first launch, or right after "Clear offline data") is the one case with nothing
 * to show. Loads still do not wait for it: they report `mirrorEmpty`, the root layout shows the
 * first-sync state in the page's place, and the sync that fills the mirror re-runs the load.
 *
 * Never written to directly by a page: a page calls `repo`, and mutates only through `outbox`. One
 * writer for the mirror, mirroring how `src/notes/store.ts` is the one writer for `notes` one layer
 * in. How fresh the data is lives in `offline.lastSyncedAt`, not in what a read returns, since every
 * read now comes from the same place.
 */

import * as db from "./db.js";
import { getLastSyncedAt, sync } from "./sync.js";
import { mirrorKey, type MirrorKey, type MirrorStore } from "./deps.js";
import type { RenderedReport } from "#lib/server/reports.js";
import type { ExtractedJson } from "#lib/server/extractions.js";
import type { HarvestDoc, HarvestRun } from "#lib/server/contextBuilder.js";
import type { NoteRow as MirroredNote } from "#lib/notes/api.js";
import type { IngestFailure, StepAttempt } from "#lib/pipeline.js";

/** A load's `depends`. */
export type Depends = (...deps: MirrorKey[]) => void;

function watch(depends: Depends, ...stores: MirrorStore[]): void {
  depends(mirrorKey("status"), ...stores.map(mirrorKey));
  void sync();
}

/** True until the first sync on this device (or after "Clear offline data") has filled the mirror. */
export async function mirrorEmpty(): Promise<boolean> {
  return (await getLastSyncedAt()) === null;
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

export async function report(depends: Depends, date: string): Promise<MirroredReport | null> {
  watch(depends, "reports");
  return (await db.get<MirroredReport>("reports", date)) ?? null;
}

/** The dates of every mirrored report, newest first - what `/` resolves to, and what a report page
 *  uses for its prev/next steppers. */
export async function reportDates(depends: Depends): Promise<string[]> {
  watch(depends, "reports");
  const rows = await db.getAll<MirroredReport>("reports");
  return rows.map((r) => r.date).sort((a, b) => b.localeCompare(a));
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

export async function extractionsFor(depends: Depends, ids: string[]): Promise<MirroredExtraction[]> {
  watch(depends, "extractions");
  const all = await Promise.all(ids.map((id) => db.get<MirroredExtraction>("extractions", id)));
  // Same order as requested; the detail page does not depend on a sort beyond "the ones asked for".
  return all.filter((item): item is MirroredExtraction => !!item);
}

/** Every mirrored note, trash included. `/notes` filters them itself (`filterNotes`), so typing in
 *  its search box never re-runs the load. */
export async function notes(depends: Depends): Promise<MirroredNote[]> {
  watch(depends, "notes");
  return db.getAll<MirroredNote>("notes");
}

export interface NotesFilter {
  scope: string;
  query: string;
  sort: "newest" | "oldest" | "edited";
  view: "active" | "deleted" | "all";
}

/** How many notes one view renders, as the server-rendered page did. */
const NOTES_SHOWN = 200;

export function filterNotes(all: MirroredNote[], filter: NotesFilter): MirroredNote[] {
  const query = filter.query.trim().toLowerCase();
  const filtered = all.filter((n) => {
    if (filter.scope && n.scope !== filter.scope) return false;
    if (query && !n.content.toLowerCase().includes(query)) return false;
    if (filter.view === "deleted") return !!n.deleted_at;
    if (filter.view === "all") return true;
    return !n.deleted_at;
  });

  filtered.sort((a, b) => {
    if (filter.sort === "oldest") return a.created_at.localeCompare(b.created_at);
    if (filter.sort === "edited") return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
    return b.created_at.localeCompare(a.created_at);
  });

  return filtered.slice(0, NOTES_SHOWN);
}

export interface MirroredRule {
  id: string;
  key: string;
  value: string;
  source: string;
  updatedAt: string | null;
}

export async function rules(depends: Depends): Promise<MirroredRule[]> {
  watch(depends, "rules");
  const rows = await db.getAll<MirroredRule>("rules");
  return rows.sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key));
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

export async function contextDoc(depends: Depends): Promise<MirroredContextDoc> {
  watch(depends, "contextDoc");
  return (await db.get<MirroredContextDoc>("contextDoc", "current")) ?? EMPTY_CONTEXT_DOC;
}

// --- the reference tables (OFFLINE_PLAN.md §1; H3). Read-only here: their writes are corrections
// and topic curation, which stay online-only (§1), so the outbox never touches these stores. ---

export interface MirroredEntity {
  id: string;
  name: string;
  aliases: string[];
  type: string | null;
  domain: string | null;
  summary: string | null;
  firstSeen: string | null;
  lastMentioned: string | null;
  mentionCount: number;
  status: string;
  importance: string;
  locked: boolean;
}

/** Most mentioned first, as the server-rendered table sorted them. */
export async function entities(depends: Depends): Promise<MirroredEntity[]> {
  watch(depends, "entities");
  const rows = await db.getAll<MirroredEntity>("entities");
  return rows.sort(
    (a, b) => b.mentionCount - a.mentionCount || (b.lastMentioned ?? "").localeCompare(a.lastMentioned ?? ""),
  );
}

export interface EntityRelation {
  id: string;
  otherId: string;
  otherName: string;
  otherType: string | null;
  relationType: string | null;
  confidence: number | null;
  direction: "out" | "in";
  firstSeen: string | null;
  lastSeen: string | null;
  confirmed: boolean;
}

export interface EntityAppearance {
  id: string;
  reportDate: string | null;
  contextSnippet: string | null;
  relevanceScore: number | null;
}

interface MirroredRelation {
  id: string;
  fromId: string;
  toId: string;
  relationType: string | null;
  confidence: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  confirmed: boolean;
}

interface MirroredAppearance extends EntityAppearance {
  entityId: string;
}

/**
 * One entity with its edges read in both directions ("who does this relate to" is the question,
 * and an edge stored the other way round is the same edge) and its appearances inside the report
 * window. Null when the mirror has no such entity.
 */
export async function entity(
  depends: Depends,
  id: string,
): Promise<{ entity: MirroredEntity; relations: EntityRelation[]; appearances: EntityAppearance[] } | null> {
  watch(depends, "entities", "entityRelations", "entityAppearances");
  const [row, all, relationRows, appearanceRows] = await Promise.all([
    db.get<MirroredEntity>("entities", id),
    db.getAll<MirroredEntity>("entities"),
    db.getAll<MirroredRelation>("entityRelations"),
    db.getAll<MirroredAppearance>("entityAppearances"),
  ]);
  if (!row) return null;

  const byId = new Map(all.map((e) => [e.id, e]));
  const relations: EntityRelation[] = [];
  for (const r of relationRows) {
    if (r.fromId !== id && r.toId !== id) continue;
    const direction = r.fromId === id ? "out" : "in";
    const other = byId.get(direction === "out" ? r.toId : r.fromId);
    if (!other) continue;
    relations.push({
      id: r.id,
      otherId: other.id,
      otherName: other.name,
      otherType: other.type,
      relationType: r.relationType,
      confidence: r.confidence,
      direction,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      confirmed: r.confirmed,
    });
  }
  relations.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || a.otherName.localeCompare(b.otherName));

  const appearances = appearanceRows
    .filter((a) => a.entityId === id)
    .sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  return { entity: row, relations, appearances };
}

export interface MirroredContact {
  id: string;
  identifier: string;
  name: string | null;
  relationship: string | null;
  priority: string;
  contextNotes: string | null;
  firstSeen: string | null;
  updatedAt: string | null;
  locked: boolean;
  /** Seeded once from the Context Builder's corpus, then owned by the live pipeline. */
  emailCount: number;
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1 };

export async function contacts(depends: Depends): Promise<MirroredContact[]> {
  watch(depends, "contacts");
  const rows = await db.getAll<MirroredContact>("contacts");
  return rows.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
      b.emailCount - a.emailCount ||
      a.identifier.localeCompare(b.identifier),
  );
}

export interface MirroredTopic {
  id: string;
  headline: string;
  domain: string;
  runningSummary: string | null;
  firstSeen: string;
  lastUpdated: string;
  status: string;
  updateCount: number;
  sources: string[];
}

/** Most recently updated first. */
export async function topics(depends: Depends): Promise<MirroredTopic[]> {
  watch(depends, "topics");
  const rows = await db.getAll<MirroredTopic>("topics");
  return rows.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated) || b.updateCount - a.updateCount);
}

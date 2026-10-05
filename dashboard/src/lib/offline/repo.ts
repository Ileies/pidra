/**
 * The read API the mirrored pages use. Local-first: every
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
import type {
  EntityAppearance,
  MirroredAppearance,
  MirroredContact,
  MirroredCorrection,
  MirroredEntity,
  MirroredReport,
  MirroredTopic,
} from "#lib/mirror/types.js";
import type { ExtractedJson } from "#lib/server/extractions.js";
import type { HarvestDoc, HarvestRun } from "#lib/server/contextHarvest.js";
import type { NoteRow as MirroredNote } from "#lib/notes/api.js";

/**
 * A load's `depends`, or null for a read from a component (the inline source expansion, the
 * archive picker), which has no load to re-run and simply reads again when it next opens.
 */
export type Depends = ((...deps: MirrorKey[]) => void) | null;

function watch(depends: Depends, ...stores: MirrorStore[]): void {
  depends?.(mirrorKey("status"), ...stores.map(mirrorKey));
  void sync();
}

/** True until the first sync on this device (or after "Clear offline data") has filled the mirror. */
export async function mirrorEmpty(): Promise<boolean> {
  return (await getLastSyncedAt()) === null;
}

export type { EntityAppearance, MirroredAppearance, MirroredContact, MirroredCorrection, MirroredEntity, MirroredReport, MirroredTopic };

export async function report(depends: Depends, date: string): Promise<MirroredReport | null> {
  watch(depends, "reports");
  return (await db.get<MirroredReport>("reports", date)) ?? null;
}

/** The dates of every mirrored report, newest first - what `/` resolves to, and what a report page
 *  uses for its prev/next steppers. */
export async function reportDates(depends: Depends): Promise<string[]> {
  watch(depends, "reports");
  return (await db.keys("reports")).sort((a, b) => b.localeCompare(a));
}

export interface ArchiveDay {
  date: string;
  summary: string | null;
  itemsIncluded: number | null;
}

/** What the date picker lists: every mirrored day, newest first, with a one-line preview. */
export async function archive(depends: Depends): Promise<ArchiveDay[]> {
  watch(depends, "reports");
  const rows = await db.getAll<MirroredReport>("reports");
  return rows
    .map((r) => ({
      date: r.date,
      // The stored summary is the first few lines of Section 1 verbatim, markdown and all. One
      // trimmed line is what a picker row has space for.
      summary: (r.report?.shortSummary ?? "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || null,
      itemsIncluded: r.report?.itemsIncluded ?? null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
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
export const NOTES_SHOWN = 200;

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

export interface MirroredContextDoc {
  id: "current";
  run: HarvestRun | null;
  doc: HarvestDoc | null;
  docError: string | null;
  skipped: { startedAt: string; mode: string; reason: string }[];
  corrections: MirroredCorrection[];
  counts: { contacts: number; entities: number; indexed_email: number; indexed_keep: number };
}

const EMPTY_CONTEXT_DOC: MirroredContextDoc = {
  id: "current",
  run: null,
  doc: null,
  docError: null,
  skipped: [],
  corrections: [],
  counts: { contacts: 0, entities: 0, indexed_email: 0, indexed_keep: 0 },
};

export async function contextDoc(depends: Depends): Promise<MirroredContextDoc> {
  watch(depends, "contextDoc");
  return (await db.get<MirroredContextDoc>("contextDoc", "current")) ?? EMPTY_CONTEXT_DOC;
}

// --- the reference tables. Read-only here: their writes are corrections
// and topic curation, which stay online-only, so the outbox never touches these stores. ---

/** Most mentioned first, as the server-rendered table sorted them. */
export async function entities(depends: Depends): Promise<MirroredEntity[]> {
  watch(depends, "entities");
  const rows = await db.getAll<MirroredEntity>("entities");
  return rows.sort(
    (a, b) => b.mentionCount - a.mentionCount || (b.lastMentioned ?? "").localeCompare(a.lastMentioned ?? ""),
  );
}

/** One entity and its appearances inside the report window. Null when the mirror has no such entity. */
export async function entity(
  depends: Depends,
  id: string,
): Promise<{ entity: MirroredEntity; appearances: EntityAppearance[] } | null> {
  watch(depends, "entities", "entityAppearances");
  const [row, appearanceRows] = await Promise.all([
    db.get<MirroredEntity>("entities", id),
    db.getAllBy<MirroredAppearance>("entityAppearances", "entityId", id),
  ]);
  if (!row) return null;

  const appearances = appearanceRows.sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  return { entity: row, appearances };
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

/** Most recently updated first. */
export async function topics(depends: Depends): Promise<MirroredTopic[]> {
  watch(depends, "topics");
  const rows = await db.getAll<MirroredTopic>("topics");
  return rows.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated) || b.updateCount - a.updateCount);
}

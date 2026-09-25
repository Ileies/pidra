/**
 * What makes an offline sync cheap. `/api/offline/snapshot` used to
 * assemble and send the whole 60-day window, 645 kB, on every pull. Three layers now sit in front
 * of that, each one cheaper than the next:
 *
 * 1. **The fingerprint.** One query that hashes, inside Postgres, every row the snapshot is made
 *    from. It decides whether the assembled snapshot held in this process is still the truth, so
 *    sixty `renderReport()` calls do not run on every request. Row hashes rather than
 *    `max(updated_at)`/`count`: `daily_reports` has no `updated_at`, a rating toggled off is a
 *    delete, and a pipeline run flipping to `failed` moves no timestamp this could key on. A
 *    fingerprint that misses a change serves a stale mirror; one that hashes the rows cannot.
 * 2. **The ETag.** A hash of the assembled rows themselves, so a match means the client already
 *    holds exactly this, and the answer is a `304` of a few hundred bytes.
 * 3. **The delta.** When the client's ETag is one this process built recently, the answer carries
 *    only the rows whose hash differs from that version, plus every id per store so a deletion
 *    still reaches the mirror. This replaces a `since=<timestamp>` delta, for the same reason as the
 *    fingerprint: a timestamp delta cannot see a change that moved no timestamp. A client whose
 *    ETag is not in the history (the process restarted, or a deploy changed the version) gets
 *    the full snapshot, which is always correct, only larger.
 *
 * Everything here is process memory: the current assembly and the row hashes of the last few
 * versions, a few hundred kB in all. Losing it costs one full pull, nothing else.
 */

import { createHash } from "node:crypto";
import { version } from "$app/env";
import { sql } from "#lib/db.js";

/** Newest report dates the mirror keeps. About 2 to 3 MB, far inside any storage quota. */
export const MIRROR_DAYS = 60;

export interface Keyed {
  id: string;
}

export type SnapshotStores = Record<string, Keyed[]>;

type RowHashes = Record<string, Map<string, string>>;

interface Built {
  etag: string;
  stores: SnapshotStores;
  hashes: RowHashes;
}

/**
 * Reassembled at least this often even when the fingerprint still matches, so an input the
 * fingerprint does not see (the harvest document is a file on disk, not a row) is at most this
 * stale in the mirror.
 */
const MAX_AGE_MS = 10 * 60_000;
/** Versions a delta can be computed against. A phone syncs a few times a day at most. */
const HISTORY_SIZE = 8;

let current: { fingerprint: string; builtAt: number; built: Built } | null = null;
let building: Promise<Built> | null = null;
const history = new Map<string, RowHashes>();

async function fingerprint(): Promise<string> {
  // `t::text` is the whole row as text, so any column change moves the hash without this list
  // having to name the columns the snapshot happens to read today.
  const [row] = await sql()`
    WITH win AS (SELECT report_date FROM daily_reports ORDER BY report_date DESC LIMIT ${MIRROR_DAYS})
    SELECT concat_ws('|',
      (SELECT md5(coalesce(string_agg(d::text, ',' ORDER BY d.report_date), ''))
         FROM daily_reports d WHERE d.report_date IN (SELECT report_date FROM win)),
      (SELECT md5(coalesce(string_agg(p::text, ',' ORDER BY p.started_at, p.id), ''))
         FROM pipeline_runs p WHERE p.run_date IN (SELECT report_date FROM win)),
      (SELECT md5(coalesce(string_agg(a::text, ',' ORDER BY a.id), ''))
         FROM report_actions a WHERE a.run_date IN (SELECT report_date FROM win)),
      (SELECT md5(coalesce(string_agg(f::text, ',' ORDER BY f.id), ''))
         FROM feedback_events f WHERE f.event_type IN ('explicit_plus', 'explicit_minus')),
      (SELECT count(*)::text || '/' || coalesce(max(created_at)::text, '') FROM extractions),
      (SELECT md5(coalesce(string_agg(n::text, ',' ORDER BY n.id), '')) FROM notes n),
      (SELECT count(*)::text FROM note_revisions),
      (SELECT md5(coalesce(string_agg(s::text, ',' ORDER BY s.id), '')) FROM standing_context s),
      (SELECT md5(coalesce(string_agg(c::text, ',' ORDER BY c.id), '')) FROM context_corrections c),
      (SELECT md5(coalesce(string_agg(r::text, ',' ORDER BY r.id), '')) FROM context_builder_runs r),
      (SELECT md5(coalesce(string_agg(ct::text, ',' ORDER BY ct.id), '')) FROM contacts ct),
      (SELECT md5(coalesce(string_agg(e::text, ',' ORDER BY e.id), '')) FROM entities e),
      (SELECT md5(coalesce(string_agg(er::text, ',' ORDER BY er.id), '')) FROM entity_relations er),
      (SELECT md5(coalesce(string_agg(ea::text, ',' ORDER BY ea.id), ''))
         FROM entity_appearances ea WHERE ea.report_date >= (SELECT min(report_date) FROM win)),
      (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) FROM active_topics t),
      (SELECT count(*)::text FROM context_builder_indexed_items)
    ) AS fp
  `;
  return String(row.fp);
}

function hashOf(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
}

function seal(stores: SnapshotStores): Built {
  const hashes: RowHashes = {};
  const overall = createHash("sha1").update(version);
  for (const [store, rows] of Object.entries(stores)) {
    const map = new Map<string, string>();
    for (const row of rows) {
      const hash = hashOf(row);
      map.set(row.id, hash);
      overall.update(`${store}:${row.id}:${hash};`);
    }
    hashes[store] = map;
  }
  // The version is part of it, so a deploy can never answer 304 to a mirror built by the old code.
  const etag = `${version}-${overall.digest("base64url").slice(0, 20)}`;
  history.delete(etag);
  history.set(etag, hashes);
  while (history.size > HISTORY_SIZE) history.delete(history.keys().next().value!);
  return { etag, stores, hashes };
}

/** The assembled snapshot, reused while the fingerprint says nothing it is made of has moved. */
export async function currentSnapshot(assemble: () => Promise<SnapshotStores>): Promise<Built> {
  const print = await fingerprint();
  if (current && current.fingerprint === print && Date.now() - current.builtAt < MAX_AGE_MS) {
    return current.built;
  }
  building ??= assemble()
    .then((stores) => {
      const built = seal(stores);
      current = { fingerprint: print, builtAt: Date.now(), built };
      return built;
    })
    .finally(() => {
      building = null;
    });
  return building;
}

/** The ETags an `If-None-Match` names, unquoted. nginx weakens an ETag (`W/`) when it compresses. */
export function requestedEtags(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

export interface SnapshotBody {
  version: string;
  etag: string;
  mode: "full" | "delta";
  /** The version the delta is relative to; null for a full snapshot. */
  base: string | null;
  generatedAt: string;
  /** Full: every row. Delta: only the rows that differ from `base`. */
  stores: SnapshotStores;
  /** Every id each store holds now, in both modes. What the client prunes against. */
  ids: Record<string, string[]>;
}

/**
 * The response body for a client that holds `known`: a delta against the first of those this
 * process still has row hashes for, otherwise the whole snapshot.
 */
export function bodyFor(built: Built, known: string[]): SnapshotBody {
  const ids = Object.fromEntries(Object.entries(built.stores).map(([store, rows]) => [store, rows.map((row) => row.id)]));
  const base = known.find((etag) => etag !== built.etag && history.has(etag)) ?? null;
  const baseHashes = base ? history.get(base)! : null;

  const stores = baseHashes
    ? Object.fromEntries(
        Object.entries(built.stores).map(([store, rows]) => {
          const before = baseHashes[store];
          const now = built.hashes[store];
          return [store, rows.filter((row) => before?.get(row.id) !== now.get(row.id))];
        }),
      )
    : built.stores;

  return {
    version,
    etag: built.etag,
    mode: baseHashes ? "delta" : "full",
    base,
    // The moment the server confirmed this is current, not when the cached assembly was built.
    generatedAt: new Date().toISOString(),
    stores,
    ids,
  };
}

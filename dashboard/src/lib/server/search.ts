/**
 * Search across the archive.
 *
 * Keyword only, against Postgres `tsvector` with GIN indexes and `ts_headline` for snippets.
 * Semantic search is parked deliberately, not rejected: it is planned as its own project, with
 * its preconditions and intended shape in `docs/todo/later.md`. It waits on the archive being
 * deep enough to generalise over, not on a decision.
 *
 * This function is the seam that keeps that a later addition rather than a rewrite: one
 * `search()` returning `{ id, kind, title, snippet, score, href }[]`, with the ranking strategy
 * behind the signature. The UI must never know which backend produced the ranking.
 */

import { sql } from "#lib/server/postgres.js";
import { sanitizeSnippet } from "#lib/markdown.js";

export type SearchKind = "report" | "extraction" | "note" | "entity";

export interface SearchHit {
  /** Unique within a kind. The report's id is its date, which is also its route. */
  id: string;
  kind: SearchKind;
  title: string;
  /** `ts_headline` output: HTML with `<mark>` around the matched terms, and nothing else. */
  snippet: string;
  score: number;
  href: string;
  /** Whatever locates the hit for a human: a date, a scope, an entity type. */
  meta?: string;
}

export interface SearchOptions {
  limit?: number;
  kinds?: SearchKind[];
}

/**
 * A user's words become a prefix-matched AND query: "export cont" finds "export controls".
 * `websearch_to_tsquery` would be the alternative, but it has no prefix matching, and a search
 * palette that only matches whole words feels broken as you type.
 */
function toTsQuery(raw: string): string | null {
  const terms = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}

const HEADLINE = "StartSel=<mark>, StopSel=</mark>, MaxFragments=2, FragmentDelimiter= … , MaxWords=18, MinWords=6";

type Db = ReturnType<typeof sql>;
type Located = Pick<SearchHit, "id" | "title" | "href" | "meta">;
type Source = (db: Db, tsQuery: string, limit: number, query: string) => Promise<SearchHit[]>;

/** One kind of hit: its own indexed query, and how a row of it becomes a `SearchHit`. */
function source<Row extends { snippet: string; score: number }>(
  kind: SearchKind,
  fetch: (db: Db, tsQuery: string, limit: number) => Promise<Row[]>,
  locate: (row: Row, query: string) => Located,
): Source {
  return async (db, tsQuery, limit, query) =>
    (await fetch(db, tsQuery, limit)).map((row) => ({ kind, snippet: row.snippet, score: row.score, ...locate(row, query) }));
}

// Four small indexed queries in parallel beat one UNION ALL that the planner has to reason
// about as a whole, and each kind gets its own title, snippet source and href shape anyway.
const SOURCES: Record<SearchKind, Source> = {
  report: source(
    "report",
    (db, tsQuery, limit) => db<{ id: string; snippet: string; score: number }[]>`
      SELECT report_date::text AS id,
             ts_headline('simple', full_report, to_tsquery('simple', ${tsQuery}), ${HEADLINE}) AS snippet,
             ts_rank(search_tsv, to_tsquery('simple', ${tsQuery})) AS score
      FROM daily_reports
      WHERE search_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC, report_date DESC
      LIMIT ${limit}
    `,
    (row) => ({ id: row.id, title: row.id, href: `/${row.id}`, meta: "Report" }),
  ),
  extraction: source(
    "extraction",
    (db, tsQuery, limit) => db<{
      id: string;
      run_date: string;
      title: string;
      source_name: string | null;
      snippet: string;
      score: number;
    }[]>`
      SELECT e.id::text AS id,
             e.run_date::text AS run_date,
             coalesce(e.extracted_json ->> 'headline', e.extracted_json ->> 'key_claim', '(no headline)') AS title,
             r.source_name,
             ts_headline('simple',
               coalesce(e.extracted_json ->> 'key_claim', '') || ' ' || coalesce(e.extracted_json ->> 'action_required', ''),
               to_tsquery('simple', ${tsQuery}), ${HEADLINE}) AS snippet,
             ts_rank(e.search_tsv, to_tsquery('simple', ${tsQuery})) AS score
      FROM extractions e
      JOIN raw_items r ON r.id = e.raw_item_id
      WHERE e.search_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC, e.run_date DESC
      LIMIT ${limit}
    `,
    (row) => ({ id: row.id, title: row.title, href: `/${row.run_date}/detail/${row.id}`, meta: row.source_name ?? "Item" }),
  ),
  note: source(
    "note",
    (db, tsQuery, limit) => db<{ id: string; scope: string; snippet: string; score: number }[]>`
      SELECT id::text AS id, scope,
             ts_headline('simple', content, to_tsquery('simple', ${tsQuery}), ${HEADLINE}) AS snippet,
             ts_rank(search_tsv, to_tsquery('simple', ${tsQuery})) AS score
      FROM notes
      WHERE deleted_at IS NULL AND search_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC
      LIMIT ${limit}
    `,
    (row, query) => ({
      id: row.id,
      title: row.snippet.replace(/<\/?mark>/g, "").slice(0, 60) || "Note",
      href: `/notes?q=${encodeURIComponent(query)}`,
      meta: `Note · ${row.scope}`,
    }),
  ),
  entity: source(
    "entity",
    (db, tsQuery, limit) => db<{ id: string; name: string; type: string | null; snippet: string; score: number }[]>`
      SELECT id::text AS id, name, type, mention_count,
             ts_headline('simple', coalesce(summary, name), to_tsquery('simple', ${tsQuery}), ${HEADLINE}) AS snippet,
             ts_rank(search_tsv, to_tsquery('simple', ${tsQuery})) AS score
      FROM entities
      WHERE search_tsv @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC, mention_count DESC NULLS LAST
      LIMIT ${limit}
    `,
    (row) => ({ id: row.id, title: row.name, href: `/entities/${row.id}`, meta: row.type ?? "Entity" }),
  ),
};

export async function search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const tsQuery = toTsQuery(query);
  if (!tsQuery) return [];

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const kinds = options.kinds ?? (Object.keys(SOURCES) as SearchKind[]);
  const db = sql();

  const hits = (await Promise.all(kinds.map((kind) => SOURCES[kind](db, tsQuery, limit, query)))).flat();

  // ts_headline does not escape the source text it wraps, so a report containing raw HTML would
  // otherwise come straight back out through the palette's {@html}.
  return hits
    .map((hit) => ({ ...hit, snippet: sanitizeSnippet(hit.snippet) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

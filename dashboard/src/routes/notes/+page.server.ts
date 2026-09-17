import type { PageServerLoad } from "./$types";
import { sql } from "#lib/db.js";

export interface NoteRow {
  id: string;
  content: string;
  scope: string;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  revision_count: number;
}

const SORTS = ["newest", "oldest", "edited"] as const;
const VIEWS = ["active", "deleted", "all"] as const;

/**
 * Reads only. Writes go to the bridge through `/api/notes`, so `src/notes/store.ts` stays the
 * single writer and every edit lands in `note_revisions`. Keeping the read here means the page
 * still renders when the bridge is down.
 */
export const load: PageServerLoad = async ({ url }) => {
  const scope = url.searchParams.get("scope") ?? "";
  const query = (url.searchParams.get("q") ?? "").trim();
  const sortParam = url.searchParams.get("sort") ?? "newest";
  const viewParam = url.searchParams.get("view") ?? "active";

  const sort = (SORTS as readonly string[]).includes(sortParam) ? sortParam : "newest";
  const view = (VIEWS as readonly string[]).includes(viewParam) ? viewParam : "active";

  const rows = await sql()`
    SELECT
      n.id, n.content, n.scope, n.created_at, n.updated_at, n.expires_at,
      n.created_by, n.updated_by, n.deleted_at,
      (SELECT count(*) FROM note_revisions r WHERE r.note_id = n.id)::int AS revision_count
    FROM notes n
    WHERE
      (${scope} = '' OR n.scope = ${scope})
      AND (${query} = '' OR n.content ILIKE ${"%" + query + "%"})
      AND CASE
            WHEN ${view} = 'deleted' THEN n.deleted_at IS NOT NULL
            WHEN ${view} = 'all' THEN TRUE
            ELSE n.deleted_at IS NULL
          END
    ORDER BY
      CASE WHEN ${sort} = 'oldest' THEN n.created_at END ASC,
      CASE WHEN ${sort} = 'edited' THEN coalesce(n.updated_at, n.created_at) END DESC,
      n.created_at DESC
    LIMIT 200
  `;

  // The trash count drives the badge on the trash toggle, so a soft-deleted note is never lost
  // just because the user forgot the view exists.
  const [counts] = await sql()`
    SELECT
      count(*) FILTER (WHERE deleted_at IS NULL)::int AS active,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
    FROM notes
  `;

  return {
    notes: rows as unknown as NoteRow[],
    scopeFilter: scope,
    query,
    sort,
    view,
    counts: counts as unknown as { active: number; deleted: number },
  };
};

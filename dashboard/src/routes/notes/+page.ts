import type { PageLoad } from "./$types";
import { notes } from "#lib/offline/repo.js";

/**
 * Client-rendered and local-first (OFFLINE_PLAN.md O2). Writes already went through `/api/notes`
 * (the bridge, keeping `src/notes/store.ts` the single writer) rather than a form action here, so
 * there is no `+page.server.ts` left once the read moves to the mirror - nothing else was in it.
 */
export const ssr = false;

const SORTS = ["newest", "oldest", "edited"] as const;
const VIEWS = ["active", "deleted", "all"] as const;

export const load: PageLoad = async ({ url }) => {
  const scopeFilter = url.searchParams.get("scope") ?? "";
  const query = (url.searchParams.get("q") ?? "").trim();
  const sortParam = url.searchParams.get("sort") ?? "newest";
  const viewParam = url.searchParams.get("view") ?? "active";

  const sort = ((SORTS as readonly string[]).includes(sortParam) ? sortParam : "newest") as (typeof SORTS)[number];
  const view = ((VIEWS as readonly string[]).includes(viewParam) ? viewParam : "active") as (typeof VIEWS)[number];

  const { data, source, syncedAt } = await notes({ scope: scopeFilter, query, sort, view });

  return {
    notes: data.notes,
    scopeFilter,
    query,
    sort,
    view,
    counts: data.counts,
    source,
    syncedAt,
  };
};

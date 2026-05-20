import type { PageServerLoad } from "./$types";
import { sql } from "$lib/db";

export const load: PageServerLoad = async ({ url }) => {
  const statusFilter = url.searchParams.get("status") ?? "all";
  const typeFilter = url.searchParams.get("type") ?? "";
  const search = url.searchParams.get("q") ?? "";

  const rows = await sql()`
    SELECT id, name, aliases, type, domain, summary, first_seen, last_mentioned, mention_count, status, importance
    FROM entities
    WHERE
      (${statusFilter} = 'all' OR status = ${statusFilter})
      AND (${typeFilter} = '' OR type = ${typeFilter})
      AND (${search} = '' OR name ILIKE ${"%" + search + "%"})
    ORDER BY mention_count DESC NULLS LAST, last_mentioned DESC NULLS LAST
    LIMIT 200
  `;

  const typesResult = await sql()`SELECT DISTINCT type FROM entities WHERE type IS NOT NULL ORDER BY type`;

  return {
    entities: rows as unknown as {
      id: string;
      name: string;
      aliases: string[] | null;
      type: string | null;
      domain: string | null;
      summary: string | null;
      first_seen: string | null;
      last_mentioned: string | null;
      mention_count: number | null;
      status: string | null;
      importance: string | null;
    }[],
    statusFilter,
    typeFilter,
    search,
    types: (typesResult as unknown as { type: string }[]).map((r) => r.type),
  };
};

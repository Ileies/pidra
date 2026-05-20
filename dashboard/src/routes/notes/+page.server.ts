import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "$lib/db";

export const load: PageServerLoad = async ({ url }) => {
  const scopeFilter = url.searchParams.get("scope") ?? "";

  const rows = await sql()`
    SELECT id, content, scope, created_at, expires_at, created_by
    FROM notes
    WHERE
      (${scopeFilter} = '' OR scope = ${scopeFilter})
    ORDER BY created_at DESC
    LIMIT 200
  `;

  return {
    notes: rows as unknown as {
      id: string;
      content: string;
      scope: string;
      created_at: string;
      expires_at: string | null;
      created_by: string | null;
    }[],
    scopeFilter,
  };
};

export const actions: Actions = {
  add: async ({ request }) => {
    const data = await request.formData();
    const content = (data.get("content") as string | null)?.trim() ?? "";
    const scope = (data.get("scope") as string | null) ?? "global";

    if (!content) return fail(400, { error: "Content required" });

    const validScopes = ["global", "intel", "personal", "contact", "search"];
    if (!validScopes.includes(scope)) return fail(400, { error: "Invalid scope" });

    await sql()`
      INSERT INTO notes (content, scope, created_by)
      VALUES (${content}, ${scope}, 'user')
    `;

    return { added: true };
  },

  delete: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id") as string | null;

    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { error: "Invalid id" });

    await sql()`DELETE FROM notes WHERE id = ${id} AND created_by = 'user'`;

    return { deleted: true };
  },
};

import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "$lib/db";

/**
 * Standing context (D3).
 *
 * `standing_context` is injected into the Section 2 prompt as the user's own persistent rules,
 * and the whole design assumes the user curates it. Until now the only view of it was read-only,
 * inside the Context Builder document.
 *
 * The harvest itself is never overwritten (CLAUDE.md), and these rows are the one part of it the
 * owner writes directly: `source` records who put a rule there, and a Keep-seeded rule keeps that
 * provenance visible even after it is edited here. Rows the Context Builder seeded are still
 * re-seedable, so an edit to one is flagged as `user` and will not be silently reverted.
 */

export interface RuleRow {
  id: string;
  key: string;
  value: string;
  source: string;
  updatedAt: string | null;
}

const KEY_RE = /^[a-z0-9_]{2,64}$/;

export const load: PageServerLoad = async () => {
  const rows = await sql()`
    SELECT id, key, value, source, updated_at
    FROM standing_context
    ORDER BY source, key
  `;

  return {
    rules: rows.map((row) => ({
      id: row.id as string,
      key: row.key as string,
      value: row.value as string,
      source: (row.source as string | null) ?? "context_builder",
      updatedAt: (row.updated_at as string | null) ?? null,
    })) as RuleRow[],
  };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const data = await request.formData();
    const key = (data.get("key") as string | null)?.trim().toLowerCase() ?? "";
    const value = (data.get("value") as string | null)?.trim() ?? "";

    if (!KEY_RE.test(key)) return fail(400, { error: "A key is lowercase letters, digits and underscores, 2-64 characters." });
    if (!value) return fail(400, { error: "A rule needs text." });

    const db = sql();
    const [existing] = await db`SELECT 1 FROM standing_context WHERE key = ${key}`;
    if (existing) return fail(409, { error: `A rule with the key "${key}" already exists.` });

    await db`INSERT INTO standing_context (key, value, source) VALUES (${key}, ${value}, 'user')`;
    return { ok: true, message: `Added "${key}".` };
  },

  update: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    const value = (data.get("value") as string | null)?.trim() ?? "";

    if (!id) return fail(400, { error: "Missing rule id" });
    if (!value) return fail(400, { error: "A rule needs text." });

    // The edit is attributed to the user, so a Context Builder re-run can tell a harvested rule
    // from one the owner has since rewritten.
    await sql()`UPDATE standing_context SET value = ${value}, source = 'user', updated_at = now() WHERE id = ${id}`;
    return { ok: true, message: "Rule updated." };
  },

  delete: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    if (!id) return fail(400, { error: "Missing rule id" });

    await sql()`DELETE FROM standing_context WHERE id = ${id}`;
    return { ok: true, message: "Rule deleted." };
  },
};

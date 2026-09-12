import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { readContextDocument } from "$lib/server/contextBuilder";
import { renderMarkdown } from "$lib/markdown";
import { env } from "$env/dynamic/private";
import { sql } from "$lib/db";

const API = env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/**
 * The synthesised context document lives on disk, not in Postgres, and its path is recorded on
 * the run row. So the page reads the newest completed run's `output_path` rather than a table.
 */
export const load: PageServerLoad = async () => {
  const db = sql();

  const [run] = await db`
    SELECT id, mode, started_at, completed_at, items_indexed, output_path
    FROM context_builder_runs
    WHERE status = 'completed'
    ORDER BY started_at DESC
    LIMIT 1
  `;

  let doc: {
    generatedAt: string | null;
    date: string | null;
    path: string;
    fullContextHtml: string;
    chars: number;
    sections: { key: string; title: string; html: string; chars: number }[];
  } | null = null;
  let docError: string | null = null;

  if (run?.output_path) {
    try {
      const file = await readContextDocument(run.output_path as string);
      const raw = JSON.parse(file.content) as Record<string, string>;
      const section = (key: string, title: string) => ({
        key,
        title,
        html: renderMarkdown(raw[key]),
        chars: (raw[key] ?? "").length,
      });
      doc = {
        generatedAt: raw.generatedAt ?? null,
        date: raw.date ?? null,
        path: file.path,
        fullContextHtml: renderMarkdown(raw.fullContext),
        chars: (raw.fullContext ?? "").length,
        sections: [
          section("keep", "Personal knowledge (Keep notes)"),
          section("contacts", "Contact directory (email)"),
          section("github", "Technical profile (GitHub)"),
          section("tasks", "Active commitments (Tasks)"),
        ],
      };
    } catch (err) {
      // A missing or unreadable file is worth surfacing: the run says it wrote one.
      docError = err instanceof Error ? err.message : String(err);
    }
  }

  const standing = await db`
    SELECT key, value, source, updated_at FROM standing_context ORDER BY updated_at DESC, key
  `;

  const [counts] = await db`
    SELECT
      (SELECT count(*) FROM contacts)::int                        AS contacts,
      (SELECT count(*) FROM entities)::int                        AS entities,
      (SELECT count(*) FROM standing_context)::int                AS standing_context,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'email')::int                              AS indexed_email,
      (SELECT count(*) FROM context_builder_indexed_items
        WHERE source = 'keep')::int                               AS indexed_keep
  `;

  // The correction layer over everything above. Shown next to the harvest on purpose: the
  // harvested text is never edited, so this list is the only place the current truth is visible.
  const corrections = await db`
    SELECT id, target_kind, target_key, operation, statement, supersedes_text, rationale,
           source, created_at
    FROM context_corrections
    WHERE status = 'active'
    ORDER BY created_at DESC
  `;

  return { run: run ?? null, doc, docError, standing, counts, corrections };
};

export const actions: Actions = {
  revertCorrection: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { error: "Invalid correction id" });

    try {
      const res = await fetch(`${API}/api/context/corrections/${id}/revert`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) return fail(res.status, { error: body.error ?? "Revert failed" });
      return { message: body.message as string };
    } catch (err) {
      return fail(502, { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` });
    }
  },
};

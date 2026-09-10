import type { PageServerLoad } from "./$types";
import { readFile } from "node:fs/promises";
import { marked } from "marked";
import { sql } from "$lib/db";

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
      const raw = JSON.parse(await readFile(run.output_path as string, "utf-8")) as Record<string, string>;
      const section = (key: string, title: string) => ({
        key,
        title,
        html: marked(raw[key] ?? "") as string,
        chars: (raw[key] ?? "").length,
      });
      doc = {
        generatedAt: raw.generatedAt ?? null,
        date: raw.date ?? null,
        path: run.output_path as string,
        fullContextHtml: marked(raw.fullContext ?? "") as string,
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

  return { run: run ?? null, doc, docError, standing, counts };
};

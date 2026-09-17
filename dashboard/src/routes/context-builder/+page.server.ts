import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { readContextDocument } from "#lib/server/contextBuilder.js";
import { renderMarkdown } from "#lib/markdown.js";
import { SKILLS_BRIDGE_URL } from "$app/env/private";
import { sql } from "#lib/db.js";

const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** How far back to look for a run that produced an actual harvest, before giving up. */
const CANDIDATE_RUNS = 6;

/**
 * Whether a run's output is the context document or something that only describes a change to it.
 *
 * Both a full build and an update run are supposed to write the whole document, structured as
 * top-level `# 1.` ... `# 5.` sections - an update run merges the delta into the previous document
 * and emits the merged result (`synthesizePatch`, and `DOCUMENT_STRUCTURE` next to it). The
 * 2026-09-11 run predates that prompt and answered with a delta instead: one "# Updated Personal
 * Context" title over "## 1." topic headings.
 *
 * Same test the pipeline applies in `pickSections`, for the same reason: the shape of the document
 * is what says whether it is usable, not the `mode` column or the run's status.
 */
function isDocument(fullContext: string): boolean {
  return (/^#\s*\d+\./m).test(fullContext);
}

interface Doc {
  generatedAt: string | null;
  date: string | null;
  path: string;
  fullContextHtml: string;
  chars: number;
  sections: { key: string; title: string; html: string; chars: number }[];
}

/**
 * The synthesised context document lives on disk, not in Postgres, and its path is recorded on
 * the run row.
 *
 * The newest completed run is *not* always the right row to read. A run whose output is a delta
 * rather than a document is not a newer version of the context - it is a fraction of it, and not
 * what the daily pipeline is synthesising on either, since `loadLongTermContext` skips it by the
 * same test. Rendering it here as "the context" showed a page of change notes in place of the
 * profile.
 *
 * So the newest run that produced an actual document wins, and anything newer that was skipped is
 * reported rather than quietly passed over: an older document on screen with no explanation is the
 * other half of the same bug.
 */
export const load: PageServerLoad = async () => {
  const db = sql();

  const runs = await db`
    SELECT id, mode, started_at, completed_at, items_indexed, output_path
    FROM context_builder_runs
    WHERE status = 'completed'
    ORDER BY started_at DESC
    LIMIT ${CANDIDATE_RUNS}
  `;

  let run: (typeof runs)[number] | null = null;
  let doc: Doc | null = null;
  let docError: string | null = null;
  const skipped: { startedAt: string; mode: string; reason: string }[] = [];

  for (const candidate of runs) {
    const note = (reason: string) =>
      skipped.push({
        startedAt: candidate.started_at as string,
        mode: candidate.mode as string,
        reason,
      });

    if (!candidate.output_path) {
      note("recorded no output file");
      continue;
    }

    let raw: Record<string, string>;
    let path: string;
    try {
      const file = await readContextDocument(candidate.output_path as string);
      raw = JSON.parse(file.content) as Record<string, string>;
      path = file.path;
    } catch (err) {
      // A missing or unreadable file is worth surfacing: the run says it wrote one.
      const message = err instanceof Error ? err.message : String(err);
      docError ??= message;
      note(message);
      continue;
    }

    const fullContext = raw.fullContext ?? "";

    if (!isDocument(fullContext)) {
      note("produced a list of changes instead of the full document, so it cannot replace it");
      continue;
    }

    const section = (key: string, title: string) => ({
      key,
      title,
      html: renderMarkdown(raw[key]),
      chars: (raw[key] ?? "").length,
    });
    run = candidate;
    doc = {
      generatedAt: raw.generatedAt ?? null,
      date: raw.date ?? null,
      path,
      fullContextHtml: renderMarkdown(fullContext),
      chars: fullContext.length,
      sections: [
        section("keep", "Personal knowledge (Keep notes)"),
        section("contacts", "Contact directory (email)"),
        section("github", "Technical profile (GitHub)"),
        section("tasks", "Active commitments (Tasks)"),
      ],
    };
    break;
  }

  run ??= runs[0] as (typeof runs)[number] | undefined ?? null;

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

  return { run: run ?? null, doc, docError, skipped, standing, counts, corrections };
};

export const actions: Actions = {
  revertCorrection: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!(/^[0-9a-f-]{36}$/i).test(id)) return fail(400, { error: "Invalid correction id" });

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

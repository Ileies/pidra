import { errMessage } from "$pipeline/util/text";
import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { CONTEXT_BUILDER_OUTPUT_DIR } from "$app/env/private";
import { sql } from "#lib/server/postgres.js";
import { renderMarkdown } from "#lib/markdown.js";

// Dashboard runs with cwd = dashboard/ - the actual tool lives one level up.
const OUTPUT_DIR = resolve(process.cwd(), "..", CONTEXT_BUILDER_OUTPUT_DIR ?? "context-builder/output");

/**
 * Reads a harvest document given the path recorded on its run row, and reports which file it
 * actually opened.
 *
 * Only used for rows written before `context_builder_runs.document` existed - every current row
 * carries the harvest in that column, which `loadHarvestDocument` reads directly. For those
 * legacy rows, `output_path` is an absolute path written by whichever machine ran the Context
 * Builder, so a plain `readFile` can fail on a different machine; the pipeline's own fallback
 * (`readDocument` in `src/pipeline/long-term-context.ts`) resolves against the process cwd, and
 * the dashboard's cwd is `dashboard/`, hence the same rule anchored on the project root instead.
 *
 * The resolved path comes back with the content because the page displays it, and displaying a
 * path that does not exist on this machine is how the mismatch stayed invisible in the first place.
 */
async function readContextDocument(
  outputPath: string,
): Promise<{ content: string; path: string }> {
  try {
    return { content: await readFile(outputPath, "utf-8"), path: outputPath };
  } catch (err) {
    const local = resolve(OUTPUT_DIR, basename(outputPath));
    if (local === outputPath) throw err;
    return { content: await readFile(local, "utf-8"), path: local };
  }
}

/** How far back to look for a run that produced an actual harvest, before giving up. */
const CANDIDATE_RUNS = 6;

/**
 * Whether a run's output is the context document or something that only describes a change to it.
 * Same test the pipeline applies in `pickSections`: the shape of the document is what says whether
 * it is usable, not the `mode` column or the run's status.
 */
function isHarvestDocument(fullContext: string): boolean {
  return (/^#\s*\d+\./m).test(fullContext);
}

export interface HarvestSection {
  key: string;
  title: string;
  html: string;
  chars: number;
}

export interface HarvestDoc {
  generatedAt: string | null;
  date: string | null;
  // Set only when the document came from the legacy archival file rather than the `document`
  // column - shown in the UI so a fallback read stays visible instead of looking identical to
  // the normal path.
  path: string | null;
  fullContextHtml: string;
  chars: number;
  sections: HarvestSection[];
}

export interface HarvestRun {
  id: string;
  mode: string;
  started_at: string;
  completed_at: string | null;
  items_indexed: number | null;
  output_path: string | null;
  document: Record<string, string> | null;
}

/**
 * The harvested context document, rendered, plus the standing rules and active corrections layered
 * over it. Shared between the live `/context-builder` page and the offline snapshot endpoint
 * so the two never render the harvest differently.
 *
 * The newest completed run is *not* always the right row to read - a run whose output is a delta
 * rather than a document is a fraction of it, not a newer version. So the newest run that produced
 * an actual document wins, and anything newer that was skipped is reported rather than quietly
 * passed over.
 */
export async function loadHarvestDocument(): Promise<{
  run: HarvestRun | null;
  doc: HarvestDoc | null;
  docError: string | null;
  skipped: { startedAt: string; mode: string; reason: string }[];
}> {
  const db = sql();

  const runs = await db<HarvestRun[]>`
    SELECT id, mode, started_at, completed_at, items_indexed, output_path, document
    FROM context_builder_runs
    WHERE status = 'completed'
    ORDER BY started_at DESC
    LIMIT ${CANDIDATE_RUNS}
  `;

  let run: HarvestRun | null = null;
  let doc: HarvestDoc | null = null;
  let docError: string | null = null;
  const skipped: { startedAt: string; mode: string; reason: string }[] = [];

  for (const candidate of runs) {
    const note = (reason: string) => skipped.push({ startedAt: candidate.started_at, mode: candidate.mode, reason });

    if (!candidate.document && !candidate.output_path) {
      note("recorded no document");
      continue;
    }

    let raw: Record<string, string>;
    let path: string | null;
    try {
      if (candidate.document) {
        raw = candidate.document;
        path = null;
      } else {
        // Legacy row, written before the document column existed: fall back to the archival file.
        const file = await readContextDocument(candidate.output_path!);
        raw = JSON.parse(file.content) as Record<string, string>;
        path = file.path;
      }
    } catch (err) {
      const message = errMessage(err);
      docError ??= message;
      note(message);
      continue;
    }

    const fullContext = raw.fullContext ?? "";
    if (!isHarvestDocument(fullContext)) {
      note("produced a list of changes instead of the full document, so it cannot replace it");
      continue;
    }

    const section = (key: string, title: string): HarvestSection => ({
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

  run ??= runs[0] ?? null;

  return { run, doc, docError, skipped };
}

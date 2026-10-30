import { sql } from "#lib/server/postgres.js";
import { renderMarkdown } from "#lib/markdown.js";

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
  document: Record<string, string> | null;
}

/**
 * The harvested context document, rendered, plus the standing rules and active corrections layered
 * over it. Shared by the live `/context-builder` page and the offline snapshot
 * (`server/offline/snapshot.ts`) so they never render the harvest differently.
 *
 * The newest completed run is not always the right row: a delta run is a fraction of the document,
 * not a newer version. The newest run that produced an actual document wins; newer skipped runs
 * are reported in `skipped`.
 */
export async function loadHarvestDocument(): Promise<{
  run: HarvestRun | null;
  doc: HarvestDoc | null;
  skipped: { startedAt: string; mode: string; reason: string }[];
}> {
  const db = sql();

  const runs = await db<HarvestRun[]>`
    SELECT id, mode, started_at, completed_at, items_indexed, document
    FROM context_builder_runs
    WHERE status = 'completed'
    ORDER BY started_at DESC
    LIMIT ${CANDIDATE_RUNS}
  `;

  let run: HarvestRun | null = null;
  let doc: HarvestDoc | null = null;
  const skipped: { startedAt: string; mode: string; reason: string }[] = [];

  for (const candidate of runs) {
    const note = (reason: string) => skipped.push({ startedAt: candidate.started_at, mode: candidate.mode, reason });

    // The document column is the harvest itself; the archival files on disk are never read.
    const raw = candidate.document;
    if (!raw) {
      note("recorded no document");
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

  return { run, doc, skipped };
}

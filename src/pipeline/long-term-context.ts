import { errMessage } from "../util/text";
import { db, contextBuilderRuns } from "../db";
import { eq, desc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { listActiveCorrections, type ActiveCorrection } from "../context/corrections";

export interface LongTermContext {
  /**
   * The user's corrections to the harvest. Injected alongside it rather than merged into it:
   * the harvested text is never rewritten, so the prompts are told the correction wins.
   */
  corrections: ActiveCorrection[];
  /** Document sections for the intel half of the briefing (interests, technical profile). */
  intelSections: string;
  /** Document sections for the personal half (identity, commitments, standing context). */
  personalSections: string;
  /**
   * The interests alone, for the fields news desk. Narrower than `intelSections` on purpose: that
   * call has a search engine attached, so it gets what the reader follows and nothing about who
   * they are or what they are building.
   */
  interestSections: string;
  generatedAt: string | null;
  /** Set when the document could not be loaded, so the pipeline can log it without failing. */
  problem: string | null;
}

// Which top-level sections of the context document go to which synthesis call. The document is
// written by synthesizeFullContext with headings "# 1. Identity & Relationships" ... "# 5.".
// Splitting it means each call carries only what it can actually act on, rather than the whole
// ~11k-token document twice a day. Override with a comma-separated list of section numbers.
/** How far back to look for a document that parses, before giving up and running without one. */
const CANDIDATE_RUNS = 5;

const INTEL_SECTIONS = process.env.PIPELINE_CONTEXT_SECTIONS_INTEL ?? "3,5";
const PERSONAL_SECTIONS = process.env.PIPELINE_CONTEXT_SECTIONS_PERSONAL ?? "1,2,4";
const INTEREST_SECTIONS = process.env.PIPELINE_CONTEXT_SECTIONS_NEWS ?? "3";

/**
 * Reads the harvest document from its archival file on disk, tolerating the fact that
 * `context_builder_runs.output_path` is an absolute path recorded by whichever machine ran the
 * Context Builder.
 *
 * The harvest itself now lives in `context_builder_runs.document`, so this is only a fallback for
 * rows written before that column existed - every reader tries `document` first. Back when the
 * path was the only record, the cross-machine mismatch (workstation runs wrote `/home/<user>/...`,
 * the server reads out of `/var/www/pidra`) meant every production briefing logged "long-term
 * context unavailable" and synthesised with `context doc 0 chars`. That is why the stored path is
 * treated as a hint, not an address: if it does not resolve, the file is looked up by name under
 * this machine's own output directory.
 *
 * Exported because the Context Builder's update mode reads the same fallback to find the document
 * it is patching, for the same legacy rows.
 */
export async function readDocument(outputPath: string): Promise<string> {
  try {
    return await readFile(outputPath, "utf-8");
  } catch (err) {
    const local = resolve(
      process.env.CONTEXT_BUILDER_OUTPUT_DIR ?? "context-builder/output",
      basename(outputPath),
    );
    if (local === outputPath) throw err;
    return await readFile(local, "utf-8");
  }
}

export function pickSections(doc: string, spec: string): string {
  const wanted = new Set(
    spec.split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (wanted.size === 0 || !doc) return "";

  return doc
    .split(/^(?=# )/m)
    .filter((block) => {
      const heading = block.match(/^#\s*(\d+)\./);
      return heading ? wanted.has(heading[1]) : false;
    })
    .join("\n")
    .trim();
}

const EMPTY: LongTermContext = {
  corrections: [],
  intelSections: "",
  personalSections: "",
  interestSections: "",
  generatedAt: null,
  problem: null,
};

/**
 * Loads the Context Builder's output for injection into the daily synthesis prompts.
 *
 * The synthesised document lives in Postgres. It is not required: a missing one degrades the
 * briefing's personalisation but must never fail the run, so problems are reported via `problem`
 * for the caller to log. The standing rules are notes and reach the prompts with the other notes.
 */
export async function loadLongTermContext(): Promise<LongTermContext> {
  const corrections = await listActiveCorrections();

  // Newest first, but not *only* the newest. An update run writes a patch document - one
  // "# Updated Personal Context" title over "## 1." topic headings that change from run to run -
  // whereas a full run writes the "# 1." to "# 5." structure `pickSections` is built to read. The
  // patch is a legitimate artefact, it is simply not a replacement for the document, and taking
  // the latest row blindly meant the 2026-09-11 update silently displaced the 2026-09-10 harvest
  // and the briefing synthesised on nothing. So a candidate has to actually yield sections to win.
  const runs = await db
    .select({
      document: contextBuilderRuns.document,
      outputPath: contextBuilderRuns.outputPath,
      completedAt: contextBuilderRuns.completedAt,
    })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(CANDIDATE_RUNS);

  if (runs.length === 0) {
    return { ...EMPTY, corrections, problem: "no completed Context Builder run" };
  }

  const problems: string[] = [];

  for (const run of runs) {
    const label = run.document ? "a run" : (run.outputPath ? basename(run.outputPath) : null);
    if (!label) {
      problems.push("a completed run recorded no document");
      continue;
    }

    try {
      // The document column holds the harvest itself, written by whichever machine ran the
      // build. Rows from before it existed fall back to the archival file via readDocument.
      const parsed = run.document ??
        (JSON.parse(await readDocument(run.outputPath!)) as { fullContext?: string; generatedAt?: string });
      const doc = parsed.fullContext ?? "";
      const intelSections = pickSections(doc, INTEL_SECTIONS);
      const personalSections = pickSections(doc, PERSONAL_SECTIONS);

      if (!intelSections && !personalSections) {
        problems.push(`${label} yielded no usable sections`);
        continue;
      }

      return {
        corrections,
        intelSections,
        personalSections,
        interestSections: pickSections(doc, INTEREST_SECTIONS),
        generatedAt: parsed.generatedAt ?? run.completedAt ?? null,
        // A fallback still worked, but the newest harvest did not, and that is worth seeing.
        problem: problems.length > 0 ? `fell back past ${problems.length} run(s): ${problems.join("; ")}` : null,
      };
    } catch (err) {
      problems.push(`${label}: ${errMessage(err)}`);
    }
  }

  return {
    ...EMPTY,
    corrections,
    problem: `no usable context document in the last ${runs.length} run(s): ${problems.join("; ")}`,
  };
}

/** One load shared by everything in a run; a failed load is not cached, so a retry reads again. */
export function shareLongTermContext(): () => Promise<LongTermContext> {
  let cached: Promise<LongTermContext> | null = null;
  return () => cached ??= loadLongTermContext().catch((err) => {
    cached = null;
    throw err;
  });
}

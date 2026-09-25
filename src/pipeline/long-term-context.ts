import { db, standingContext, contextBuilderRuns } from "../db";
import { eq, desc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { listActiveCorrections, type ActiveCorrection } from "../context/corrections";

export interface StandingRule {
  key: string;
  value: string;
}

export interface LongTermContext {
  /** Every persistent rule from `standing_context`, seeded by the Context Builder from Keep. */
  standingRules: StandingRule[];
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
 * Reads the harvest document, tolerating the fact that `context_builder_runs.output_path` is an
 * absolute path recorded by whichever machine ran the Context Builder.
 *
 * That is a cross-machine assumption the schema never actually held: the first runs happened on the
 * workstation, so the column holds `/home/<user>/...`, while the pipeline runs on the server out of
 * `/var/www/pidra`. Every production briefing since the harvest therefore logged "long-term context
 * unavailable" and synthesised with `context doc 0 chars` - the standing rules still arrived from
 * the database, but the document itself never did, silently, for the one input the Context Builder
 * exists to provide.
 *
 * So the stored path is a hint, not an address: if it does not resolve, the file is looked up by
 * name under this machine's own output directory. The proper fix is to stop putting a filesystem
 * path in a shared database at all - see TODO - but this makes the existing rows work on both
 * machines without a migration.
 *
 * Exported because the Context Builder's update mode reads the same column to find the document
 * it is patching, and had the same bug: a workstation path that the server cannot open made it
 * fall back to a full rebuild, silently and at full cost.
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
  standingRules: [],
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
 * The synthesised document lives on disk (its path is recorded on the run row), while the
 * standing rules live in Postgres. Neither is required: a missing document degrades the
 * briefing's personalisation but must never fail the run, so problems are reported via
 * `problem` for the caller to log.
 */
export async function loadLongTermContext(): Promise<LongTermContext> {
  const standingRules: StandingRule[] = (
    await db
      .select({ key: standingContext.key, value: standingContext.value })
      .from(standingContext)
  ).map((r) => ({ key: r.key, value: r.value }));

  const corrections = await listActiveCorrections();

  // Newest first, but not *only* the newest. An update run writes a patch document - one
  // "# Updated Personal Context" title over "## 1." topic headings that change from run to run -
  // whereas a full run writes the "# 1." to "# 5." structure `pickSections` is built to read. The
  // patch is a legitimate artefact, it is simply not a replacement for the document, and taking
  // the latest row blindly meant the 2026-09-11 update silently displaced the 2026-09-10 harvest
  // and the briefing synthesised on nothing. So a candidate has to actually yield sections to win.
  const runs = await db
    .select({ outputPath: contextBuilderRuns.outputPath, completedAt: contextBuilderRuns.completedAt })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(CANDIDATE_RUNS);

  if (runs.length === 0) {
    return { ...EMPTY, standingRules, corrections, problem: "no completed Context Builder run" };
  }

  const problems: string[] = [];

  for (const run of runs) {
    if (!run.outputPath) {
      problems.push("a completed run recorded no output path");
      continue;
    }

    try {
      const parsed = JSON.parse(await readDocument(run.outputPath)) as {
        fullContext?: string;
        generatedAt?: string;
      };
      const doc = parsed.fullContext ?? "";
      const intelSections = pickSections(doc, INTEL_SECTIONS);
      const personalSections = pickSections(doc, PERSONAL_SECTIONS);

      if (!intelSections && !personalSections) {
        problems.push(`${basename(run.outputPath)} yielded no usable sections`);
        continue;
      }

      return {
        standingRules,
        corrections,
        intelSections,
        personalSections,
        interestSections: pickSections(doc, INTEREST_SECTIONS),
        generatedAt: parsed.generatedAt ?? run.completedAt ?? null,
        // A fallback still worked, but the newest harvest did not, and that is worth seeing.
        problem: problems.length > 0 ? `fell back past ${problems.length} run(s): ${problems.join("; ")}` : null,
      };
    } catch (err) {
      problems.push(`${basename(run.outputPath)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ...EMPTY,
    standingRules,
    corrections,
    problem: `no usable context document in the last ${runs.length} run(s): ${problems.join("; ")}`,
  };
}

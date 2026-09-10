import { db, standingContext, contextBuilderRuns } from "../db";
import { eq, desc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
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
  generatedAt: string | null;
  /** Set when the document could not be loaded, so the pipeline can log it without failing. */
  problem: string | null;
}

// Which top-level sections of the context document go to which synthesis call. The document is
// written by synthesizeFullContext with headings "# 1. Identity & Relationships" ... "# 5.".
// Splitting it means each call carries only what it can actually act on, rather than the whole
// ~11k-token document twice a day. Override with a comma-separated list of section numbers.
const INTEL_SECTIONS = process.env.PIPELINE_CONTEXT_SECTIONS_INTEL ?? "3,5";
const PERSONAL_SECTIONS = process.env.PIPELINE_CONTEXT_SECTIONS_PERSONAL ?? "1,2,4";

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

  const [run] = await db
    .select({ outputPath: contextBuilderRuns.outputPath, completedAt: contextBuilderRuns.completedAt })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(1);

  if (!run?.outputPath) {
    return {
      ...EMPTY,
      standingRules,
      corrections,
      problem: run ? "latest completed Context Builder run recorded no output path" : "no completed Context Builder run",
    };
  }

  try {
    const parsed = JSON.parse(await readFile(run.outputPath, "utf-8")) as {
      fullContext?: string;
      generatedAt?: string;
    };
    const doc = parsed.fullContext ?? "";
    return {
      standingRules,
      corrections,
      intelSections: pickSections(doc, INTEL_SECTIONS),
      personalSections: pickSections(doc, PERSONAL_SECTIONS),
      generatedAt: parsed.generatedAt ?? run.completedAt ?? null,
      problem: doc ? null : "context document contained no fullContext",
    };
  } catch (err) {
    return {
      ...EMPTY,
      standingRules,
      corrections,
      problem: `could not read ${run.outputPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

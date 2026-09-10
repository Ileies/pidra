/**
 * Resolves which prompt text a pipeline stage actually runs with.
 *
 * `prompt_versions` is an override layer, not the source of truth: the constants in `prompts.ts`
 * are the baseline every section falls back to, and an approved row in the table replaces the
 * baseline for that section until it is deactivated. So an empty table means "run the code",
 * which is the state the system starts in, and activating a version on `/prompts` changes the
 * next run without a deploy.
 *
 * Deliberately not cached, and never resolved at import time: a run needs a handful of lookups,
 * while a cache or a module-level constant would mean an activation waits for the next process
 * restart - the exact failure this module exists to fix.
 */
import { and, eq } from "drizzle-orm";
import { db, promptVersions } from "../db";
import {
  ENTITY_EXTRACTION_PROMPT,
  NEWSLETTER_EXTRACTION_PROMPT,
  PERSONAL_EMAIL_PROMPT,
  SECTION1_SYSTEM_PROMPT,
  SECTION2_SYSTEM_PROMPT,
} from "./prompts";

/** The sections the pipeline reads. Also the display order on `/prompts`. */
export const PROMPT_SECTIONS = [
  "section1",
  "section2",
  "extraction",
  "entity_extraction",
  "personal_classification",
] as const;

export type PromptSection = (typeof PROMPT_SECTIONS)[number];

const BASELINES: Record<PromptSection, string> = {
  section1: SECTION1_SYSTEM_PROMPT,
  section2: SECTION2_SYSTEM_PROMPT,
  extraction: NEWSLETTER_EXTRACTION_PROMPT,
  entity_extraction: ENTITY_EXTRACTION_PROMPT,
  personal_classification: PERSONAL_EMAIL_PROMPT,
};

export interface EffectivePrompt {
  section: PromptSection;
  text: string;
  /** DB version number, or null when the code baseline is in use. */
  version: number | null;
  source: "db" | "code";
}

function baseline(section: PromptSection): EffectivePrompt {
  return { section, text: BASELINES[section], version: null, source: "code" };
}

/** Every section's effective prompt, in one query. */
export async function resolveActivePrompts(): Promise<Record<PromptSection, EffectivePrompt>> {
  const rows = await db
    .select({ section: promptVersions.section, version: promptVersions.version, promptText: promptVersions.promptText })
    .from(promptVersions)
    .where(eq(promptVersions.active, true));

  const resolved = Object.fromEntries(
    PROMPT_SECTIONS.map((section) => [section, baseline(section)])
  ) as Record<PromptSection, EffectivePrompt>;

  for (const row of rows) {
    // `section` is free text and `POST /api/prompts` accepts any value, so a row can name a
    // section no stage reads. Ignore it rather than inventing a stage for it.
    if (!(row.section in resolved)) continue;
    const section = row.section as PromptSection;
    resolved[section] = { section, text: row.promptText, version: row.version, source: "db" };
  }

  const overrides = PROMPT_SECTIONS.filter((s) => resolved[s].source === "db");
  if (overrides.length > 0) {
    console.log(`[prompts] DB overrides active: ${overrides.map((s) => `${s} v${resolved[s].version}`).join(", ")}`);
  }

  return resolved;
}

/** One section's effective prompt. */
export async function activePrompt(section: PromptSection): Promise<EffectivePrompt> {
  const [row] = await db
    .select({ version: promptVersions.version, promptText: promptVersions.promptText })
    .from(promptVersions)
    .where(and(eq(promptVersions.section, section), eq(promptVersions.active, true)))
    .limit(1);

  if (!row) return baseline(section);

  console.log(`[prompts] ${section}: DB v${row.version}`);
  return { section, text: row.promptText, version: row.version, source: "db" };
}

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
import { baseline, PROMPT_SECTIONS, resolvePromptRows } from "./prompt-catalog";
import type { EffectivePrompt, PromptSection } from "./prompt-catalog";

export { PROMPT_SECTIONS } from "./prompt-catalog";
export type { EffectivePrompt, PromptSection } from "./prompt-catalog";

/** Every section's effective prompt, in one query. */
export async function resolveActivePrompts(): Promise<Record<PromptSection, EffectivePrompt>> {
  const rows = await db
    .select({ section: promptVersions.section, version: promptVersions.version, promptText: promptVersions.promptText })
    .from(promptVersions)
    .where(eq(promptVersions.active, true));

  const resolved = resolvePromptRows(rows);

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

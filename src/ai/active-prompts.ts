/**
 * Resolves which prompt text a stage runs with. `prompt_versions` is an override layer: the code
 * baseline (src/ai/prompt-catalog.ts) is used unless a row is `active` for that section.
 * Deliberately not cached nor resolved at import time, so an activation applies to the next run
 * without a restart. `activePrompt` returns rendered text ({{tags}} filled); `resolveActivePrompts`
 * stays raw. Ignores `prompt_versions.approved_at`: `active` is the only switch read here.
 */
import { and, eq } from "drizzle-orm";
import { db, promptVersions } from "../db";
import { baseline, LANGUAGE_SECTIONS, PROMPT_SECTIONS, resolvePromptRows } from "./prompt-catalog";
import type { EffectivePrompt, PromptSection } from "./prompt-catalog";
import { renderPrompt } from "./prompt-vars";
import { loadPromptVars } from "../settings/store";

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

/**
 * One section's effective prompt, ready to send: its `{{tags}}` are already filled in from the
 * owner's settings. `resolveActivePrompts` above deliberately stays raw, because its callers
 * (the prompt versions API, the weekly prompt review) want the template as written.
 */
export async function activePrompt(section: PromptSection): Promise<EffectivePrompt> {
  const [row] = await db
    .select({ version: promptVersions.version, promptText: promptVersions.promptText })
    .from(promptVersions)
    .where(and(eq(promptVersions.section, section), eq(promptVersions.active, true)))
    .limit(1);

  const raw = row
    ? { section, text: row.promptText, version: row.version, source: "db" as const }
    : baseline(section);

  if (row) {
    console.log(`[prompts] ${section}: DB v${row.version}`);
    // An approved version written before `{{language}}` existed would otherwise ignore the setting without a trace.
    if (LANGUAGE_SECTIONS.includes(section) && !/\{\{\s*language\s*\}\}/.test(row.promptText)) {
      console.warn(`[prompts] ${section} v${row.version} has no {{language}} tag, so the content language setting does not apply to it`);
    }
  }

  return { ...raw, text: await renderPromptText(raw.text) };
}

/** A prompt that lives in code rather than in `PROMPT_SECTIONS`, with its `{{tags}}` filled in. */
export async function renderPromptText(template: string): Promise<string> {
  return renderPrompt(template, await loadPromptVars());
}

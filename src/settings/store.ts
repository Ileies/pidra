import { db, userSettings } from "../db";
import { resolveContentLanguage, resolveUiLanguage, contentLanguageName, type ContentLanguage, type UiLanguage } from "../config/languages";
import type { PromptVars } from "../ai/prompt-vars";

export interface UserSettings {
  uiLanguage: UiLanguage;
  contentLanguage: ContentLanguage;
}

/**
 * The owner's settings, every value resolved through the allowlist. A missing row, or a stored
 * code that is not on the list any more, reads as the default rather than as an error.
 */
export async function loadSettings(): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).limit(1);
  return {
    uiLanguage: resolveUiLanguage(row?.uiLanguage),
    contentLanguage: resolveContentLanguage(row?.contentLanguage),
  };
}

/** The values for the `{{tag}}`s in prompt text. Read per call, like the prompts: a change applies to the next run. */
export async function loadPromptVars(): Promise<PromptVars> {
  const { contentLanguage } = await loadSettings();
  return { language: contentLanguageName(contentLanguage) };
}

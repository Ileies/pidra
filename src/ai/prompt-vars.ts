/**
 * `{{tag}}` substitution for prompt text.
 *
 * A tag is replaced with a value the code chose, never with text a user or the model supplied:
 * the `language` value is the English name of an allowlisted code (`src/config/languages.ts`).
 * Substitution is one pass over the template with a replacer function, so a value is never
 * scanned for further tags and `$&`-style patterns in it mean nothing. An unknown tag is left as
 * written and logged, so a typo in an approved prompt version is visible instead of silently
 * sending `{{langauge}}` to the model.
 *
 * Pure, so prompt text can be rendered anywhere. Loading the values from the settings table is
 * `loadPromptVars` in `src/settings/store.ts`.
 */

export interface PromptVars {
  /** The English name of the content language, e.g. "German". */
  language: string;
}

/** Every tag a prompt may use, in the order the /prompts page lists them. */
export const PROMPT_VARIABLES = ["language"] as const satisfies readonly (keyof PromptVars)[];

const TAG = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(TAG, (tag, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name as keyof PromptVars];
    console.warn(`[prompts] Unknown tag ${tag} left in place`);
    return tag;
  });
}

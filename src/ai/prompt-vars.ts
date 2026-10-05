/**
 * `{{tag}}` substitution for prompt text. Values are code-chosen only (`language` is the English
 * name of an allowlisted code, src/config/languages.ts). One pass with a replacer function, so
 * values are never rescanned. An unknown tag is left in place and logged (catches typos in approved
 * prompt versions). Pure; values are loaded by `loadPromptVars` in src/settings/store.ts.
 */

export interface PromptVars {
  /** The English name of the content language, e.g. "German". */
  language: string;
}

const TAG = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(TAG, (tag, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name as keyof PromptVars];
    console.warn(`[prompts] Unknown tag ${tag} left in place`);
    return tag;
  });
}

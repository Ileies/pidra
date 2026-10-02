/**
 * The languages a user can pick, as a closed allowlist.
 *
 * The database stores a language *code* from these tables and nothing else. The prompts get the
 * English *name* from here, never the stored text, so a value that reached the table by any other
 * route (a crafted request, a manual edit) cannot become instructions to the model: an unknown
 * code resolves to the default, it is never interpolated. Pure module, no imports, so the
 * dashboard's server code, its settings page and the pipeline all read the same list.
 *
 * Right-to-left languages are left out on purpose: the report renderer has no `dir` handling yet.
 */

export const DEFAULT_LANGUAGE = "en";

export interface LanguageInfo {
  /** The English name, which is what the prompts say ("Write in German"). */
  name: string;
  /** The language's own name, for the picker. */
  native: string;
}

/** Languages the model writes in: reports, questions, assistant replies. Cheap to extend. */
export const CONTENT_LANGUAGES = {
  en: { name: "English", native: "English" },
  de: { name: "German", native: "Deutsch" },
  fr: { name: "French", native: "Français" },
  es: { name: "Spanish", native: "Español" },
  it: { name: "Italian", native: "Italiano" },
  pt: { name: "Portuguese", native: "Português" },
  nl: { name: "Dutch", native: "Nederlands" },
  pl: { name: "Polish", native: "Polski" },
  cs: { name: "Czech", native: "Čeština" },
  sv: { name: "Swedish", native: "Svenska" },
  da: { name: "Danish", native: "Dansk" },
  no: { name: "Norwegian", native: "Norsk" },
  fi: { name: "Finnish", native: "Suomi" },
  el: { name: "Greek", native: "Ελληνικά" },
  tr: { name: "Turkish", native: "Türkçe" },
  ru: { name: "Russian", native: "Русский" },
  uk: { name: "Ukrainian", native: "Українська" },
  hi: { name: "Hindi", native: "हिन्दी" },
  ja: { name: "Japanese", native: "日本語" },
  ko: { name: "Korean", native: "한국어" },
  zh: { name: "Simplified Chinese", native: "简体中文" },
} as const satisfies Record<string, LanguageInfo>;

/** Languages the dashboard's own text is translated into. Each one is hand-maintained work. */
export const UI_LANGUAGES = {
  en: { name: "English", native: "English" },
  de: { name: "German", native: "Deutsch" },
} as const satisfies Record<string, LanguageInfo>;

export type ContentLanguage = keyof typeof CONTENT_LANGUAGES;
export type UiLanguage = keyof typeof UI_LANGUAGES;

// `Object.hasOwn`, not `in`: "constructor" and "__proto__" are `in` every object.
export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === "string" && Object.hasOwn(CONTENT_LANGUAGES, value);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && Object.hasOwn(UI_LANGUAGES, value);
}

/** A stored code, or the default when it is not on the list. */
export function resolveContentLanguage(code: unknown): ContentLanguage {
  return isContentLanguage(code) ? code : DEFAULT_LANGUAGE;
}

export function resolveUiLanguage(code: unknown): UiLanguage {
  return isUiLanguage(code) ? code : DEFAULT_LANGUAGE;
}

/** The English name the prompts use for a content language code. */
export function contentLanguageName(code: unknown): string {
  return CONTENT_LANGUAGES[resolveContentLanguage(code)].name;
}

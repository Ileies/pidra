/**
 * `user_settings` reads and writes for the language fields on `/settings`, the single writer.
 *
 * Request values are untrusted: both are checked against the allowlist in
 * `src/config/languages.ts` before touching SQL and only the code is stored. Defense in depth: the
 * pipeline re-resolves it through the allowlist before a prompt (`src/settings/store.ts`) and the
 * table's CHECKs refuse anything but a two-letter code.
 */

import { sql } from "#lib/server/postgres.js";
import {
  isContentLanguage,
  isUiLanguage,
  resolveContentLanguage,
  resolveUiLanguage,
  type ContentLanguage,
  type UiLanguage,
} from "$pipeline/config/languages";

export class SettingsError extends Error {}

export interface UserSettings {
  uiLanguage: UiLanguage;
  contentLanguage: ContentLanguage;
}

export async function loadSettings(): Promise<UserSettings> {
  const [row] = await sql()<{ ui_language: string; content_language: string }[]>`
    SELECT ui_language, content_language FROM user_settings WHERE id = 1
  `;
  return {
    uiLanguage: resolveUiLanguage(row?.ui_language),
    contentLanguage: resolveContentLanguage(row?.content_language),
  };
}

/** Saves whichever of the two is present and keeps the stored value of the other. */
export async function saveLanguages(input: { uiLanguage?: unknown; contentLanguage?: unknown }): Promise<UserSettings> {
  const current = await loadSettings();
  const uiLanguage = input.uiLanguage === undefined ? current.uiLanguage : input.uiLanguage;
  const contentLanguage = input.contentLanguage === undefined ? current.contentLanguage : input.contentLanguage;
  if (!isUiLanguage(uiLanguage)) throw new SettingsError("That interface language is not available.");
  if (!isContentLanguage(contentLanguage)) throw new SettingsError("That content language is not available.");

  await sql()`
    INSERT INTO user_settings (id, ui_language, content_language, updated_at)
    VALUES (1, ${uiLanguage}, ${contentLanguage}, now())
    ON CONFLICT (id) DO UPDATE
      SET ui_language = EXCLUDED.ui_language,
          content_language = EXCLUDED.content_language,
          updated_at = now()
  `;
  return { uiLanguage, contentLanguage };
}

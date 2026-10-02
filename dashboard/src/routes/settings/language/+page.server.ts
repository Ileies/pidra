import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { loadSettings, saveLanguages, SettingsError } from "#lib/server/settings.js";

/**
 * `/settings/language`: form action only, online-only (see `ONLINE_ONLY` in `routes.ts`). The
 * action never trusts what the form sent: `saveLanguages` accepts a code only if it is on the
 * allowlist in `src/config/languages.ts`.
 */

export const load: PageServerLoad = async () => ({ settings: await loadSettings() });

export const actions: Actions = {
  save: async ({ request }) => {
    const data = await request.formData();
    try {
      await saveLanguages({ uiLanguage: data.get("uiLanguage"), contentLanguage: data.get("contentLanguage") });
      return { ok: true, message: "Languages saved. Content changes apply from the next briefing." };
    } catch (err) {
      if (err instanceof SettingsError) return fail(400, { error: err.message });
      throw err;
    }
  },
};

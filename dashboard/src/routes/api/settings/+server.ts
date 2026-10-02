import type { RequestHandler } from "./$types";
import { loadSettings, saveLanguages, SettingsError } from "#lib/server/settings.js";

/**
 * The language fields on `/settings`. That page is mirrored (`ssr = false`, no server load), so it
 * reads and writes these through the network layer instead of a form action. `saveLanguages`
 * accepts a code only if it is on the allowlist in `src/config/languages.ts`.
 */

export const GET: RequestHandler = async () => Response.json(await loadSettings());

export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { uiLanguage?: unknown; contentLanguage?: unknown };
  try {
    return Response.json(await saveLanguages({ uiLanguage: body.uiLanguage, contentLanguage: body.contentLanguage }));
  } catch (err) {
    if (err instanceof SettingsError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};

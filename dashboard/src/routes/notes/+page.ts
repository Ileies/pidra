import type { PageLoad } from "./$types";
import { mirrorEmpty, notes } from "#lib/offline/repo.js";

/**
 * Mirrored, local-first, client-rendered (no `+page.server.ts`). Writes go through `/api/notes`
 * (the bridge, keeping `src/notes/store.ts` the single writer), not form actions.
 *
 * Returns every note and leaves search, scope, sort and view to the page (`filterNotes`), so a
 * keystroke in the search box does not re-run this load.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [all, empty] = await Promise.all([notes(depends), mirrorEmpty()]);
  return { notes: all, mirrorEmpty: empty };
};

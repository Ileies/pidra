import type { PageLoad } from "./$types";
import { mirrorEmpty, notes } from "#lib/offline/repo.js";

/**
 * Client-rendered and local-first. Writes already went through `/api/notes`
 * (the bridge, keeping `src/notes/store.ts` the single writer) rather than a form action here, so
 * there is no `+page.server.ts` left once the read moves to the mirror - nothing else was in it.
 *
 * Returns every note and leaves search, scope, sort and view to the page: this load used to
 * read them from the URL, so every keystroke in the search box re-ran it, and with it a full pull.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [all, empty] = await Promise.all([notes(depends), mirrorEmpty()]);
  return { notes: all, mirrorEmpty: empty };
};

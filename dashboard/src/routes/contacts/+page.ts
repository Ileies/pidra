import type { PageLoad } from "./$types";
import { contacts, mirrorEmpty } from "#lib/offline/repo.js";

/**
 * The sender directory (D7), client-rendered and local-first. Readable
 * offline; editing is a correction and stays online-only, see `+page.server.ts`.
 *
 * `contacts` answers one question: mail arrived from this address, who is that and how much
 * should triage care. It is deliberately not a social graph - the owner's actual social circle
 * lives on a dozen messaging platforms and none of them are ingested - so a small table is the
 * expected steady state, not a seeding bug (CLAUDE.md §8). The page says so, because the first
 * reaction to six rows is otherwise "something is broken".
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, empty] = await Promise.all([contacts(depends), mirrorEmpty()]);
  return { contacts: rows, mirrorEmpty: empty };
};

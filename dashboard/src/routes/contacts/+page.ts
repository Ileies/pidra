import type { PageLoad } from "./$types";
import { contacts, mirrorEmpty } from "#lib/offline/repo.js";

/**
 * The sender directory: mirrored, client-only, readable offline; editing is a correction and stays
 * online-only, see `+page.server.ts`.
 *
 * `contacts` answers one question: mail arrived from this address, who is that and how much
 * should triage care. It is deliberately not a social graph, so a small table is the expected
 * steady state, not a seeding bug; the page says so.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, empty] = await Promise.all([contacts(depends), mirrorEmpty()]);
  return { contacts: rows, mirrorEmpty: empty };
};

import type { PageLoad } from "./$types";
import { mirrorEmpty, rules } from "#lib/offline/repo.js";

/** Client-rendered and local-first (OFFLINE_PLAN.md O2, H2). Writes go through the outbox; the
 *  form actions in `+page.server.ts` remain the no-JS path. */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, empty] = await Promise.all([rules(depends), mirrorEmpty()]);
  return { rules: rows, mirrorEmpty: empty };
};

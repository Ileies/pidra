import type { PageLoad } from "./$types";
import { rules } from "#lib/offline/repo.js";

/** Client-rendered and local-first (OFFLINE_PLAN.md O2). Writes stay in `+page.server.ts` and are
 *  online-only for now - the offline outbox for rules lands in O3. */
export const ssr = false;

export const load: PageLoad = async () => {
  const { data, source, syncedAt } = await rules();
  return { rules: data, source, syncedAt };
};

import type { PageLoad } from "./$types";
import { contextDoc } from "#lib/offline/repo.js";

/** Same mirror blob the parent page reads (`contextDoc` carries corrections alongside the
 *  harvest), so this route needs no new mirror store and stays in sync with the parent for free. */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const data = await contextDoc(depends);
  return { corrections: data.corrections };
};

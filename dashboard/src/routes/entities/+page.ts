import type { PageLoad } from "./$types";
import { entities, mirrorEmpty } from "#lib/offline/repo.js";

/**
 * Client-rendered and local-first. Was a server load with the filters in
 * SQL; the whole table is a few hundred rows, so the load returns all of it and the page filters,
 * which also means a filter change re-renders instead of re-running this load.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, empty] = await Promise.all([entities(depends), mirrorEmpty()]);
  return { entities: rows, mirrorEmpty: empty };
};

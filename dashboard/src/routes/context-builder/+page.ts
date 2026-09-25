import type { PageLoad } from "./$types";
import { contextDoc, mirrorEmpty } from "#lib/offline/repo.js";

/** Client-rendered and local-first. The run controls (start/stop, live
 *  progress) stay online-only - they need the skills bridge and live pipeline state, which a
 *  cached copy cannot represent honestly. Only the harvested document,
 *  standing rules and active corrections are read from the mirror. */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [data, empty] = await Promise.all([contextDoc(depends), mirrorEmpty()]);
  return {
    run: data.run,
    doc: data.doc,
    docError: data.docError,
    skipped: data.skipped,
    standing: data.standing,
    counts: data.counts,
    corrections: data.corrections,
    mirrorEmpty: empty,
  };
};

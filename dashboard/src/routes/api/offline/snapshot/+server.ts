import type { RequestHandler } from "./$types";
import { bodyFor, currentSnapshot, requestedEtags } from "#lib/server/snapshotCache.js";
import { assemble } from "#lib/server/offline/snapshot.js";

/**
 * The one endpoint the offline mirror pulls from. What goes over the wire is decided by
 * `#lib/server/snapshotCache.ts`: a `304` when the client's ETag is still current, a delta of the
 * rows that changed since a version this process built recently, or the whole thing. Every answer
 * lists all ids per store, so deletions reach the mirror without a tombstone list: a row missing
 * from `ids` is pruned.
 *
 * `#lib/server/offline/snapshot.ts` assembles the full window and knows nothing about any of
 * that, including the exclusion rules for what may never leave this endpoint - see that file.
 */

export const GET: RequestHandler = async ({ request }) => {
  const built = await currentSnapshot(assemble);
  // `no-store` keeps the browser's HTTP cache out of it: `sync.ts` sends `If-None-Match` itself
  // and needs to see the 304, which a cache that answered on its behalf would turn into a 200.
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: `"${built.etag}"` };
  const known = requestedEtags(request.headers.get("if-none-match"));
  if (known.includes(built.etag)) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(bodyFor(built, known)), { headers });
};

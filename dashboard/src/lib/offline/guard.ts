/**
 * What a page (`net.ts`) and the service worker (`syncFetch`) both decide about a response, once.
 * No window, no `$app/navigation`: the worker imports this.
 */

/** Every answer the app writes carries this header (`hooks.server.ts`); one without it was somebody
 *  else's, a captive portal or a proxy's error page. */
export function isOurs(response: Response): boolean {
  return response.headers.has("x-pidra");
}

/**
 * Reads the body and hands back an equal response with it already in memory. The caller reads
 * inside its own time budget, so a body that stalls after the headers cannot hold the request open.
 * A 204, 205 or 304 (the snapshot's ETag path) may not carry a body, not even an empty one: the
 * constructor throws, which would read as a transport failure.
 */
export async function buffered(response: Response): Promise<Response> {
  const body = await response.arrayBuffer();
  const nullBody = response.status === 204 || response.status === 205 || response.status === 304;
  return new Response(nullBody ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

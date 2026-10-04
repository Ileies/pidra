import { bridgeFetch } from "#lib/server/bridge.js";

/** The pipeline server is separate from the dashboard's own /api/health check. */
export const GET = async () => {
  let online = false;
  try {
    const response = await bridgeFetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    online = response.ok;
  } catch {
    // A refused connection or timeout means the pipeline server cannot serve requests.
  }

  return Response.json({ online }, { headers: { "Cache-Control": "no-store" } });
};

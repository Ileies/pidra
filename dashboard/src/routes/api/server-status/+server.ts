import { SKILLS_BRIDGE_URL } from "$app/env/private";

const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** The pipeline server is separate from the dashboard's own /api/health check. */
export const GET = async () => {
  let online = false;
  try {
    const response = await fetch(`${API}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    online = response.ok;
  } catch {
    // A refused connection or timeout means the pipeline server cannot serve requests.
  }

  return Response.json({ online }, { headers: { "Cache-Control": "no-store" } });
};

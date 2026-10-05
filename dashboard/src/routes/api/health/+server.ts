
/**
 * Liveness of the dashboard process itself - no DB access. `$lib/offline/net.ts` probes it
 * whenever a request is slower than half a second or fails in transit, to tell "slow" from "gone",
 * and `state.svelte.ts` probes it on a schedule while offline as the way back. `navigator.onLine`
 * only reports the local link, and the failure this whole feature exists for is link up, server
 * not answering (weak signal, captive portal, pronix down).
 */
export const GET = () => Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });

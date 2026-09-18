import { json } from "@sveltejs/kit";

/**
 * Liveness of the dashboard process itself - no DB access - which is exactly what the wg0 ACL
 * gates (OFFLINE_PLAN.md §8). `state.svelte.ts` probes this on a schedule to decide the header
 * dot's online/offline state; `navigator.onLine` only reports the WiFi link, and the failure this
 * whole feature exists for is WiFi up, wg0 down.
 */
export const GET = () => json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });

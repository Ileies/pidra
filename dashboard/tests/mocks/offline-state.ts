/**
 * Stub for `#lib/offline/state.svelte.js`. The real class probes the network and IndexedDB,
 * neither of which exists in this DOM; a page under test that only reads `offline.reachable`
 * needs a fixed, non-reactive value.
 */

export const offline = { reachable: "online" as "online" | "offline" | "unknown" };

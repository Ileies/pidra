/**
 * Stub for `#lib/offline/sync.js`. The real `sync()` pulls the offline snapshot over the network;
 * no test here triggers it (it only runs from a curate form's submit handler), so a no-op is
 * enough to satisfy the import.
 */

export async function sync(): Promise<void> {}

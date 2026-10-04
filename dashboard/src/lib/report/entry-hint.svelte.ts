import { readStored, writeStored } from "#lib/storage.js";

/** Whether this browser has learned that a briefing entry opens when tapped. Per-device, so it is
 *  only a convenience: storage can be empty or blocked, and the page reads fine either way. */
const KEY = "pidra:entry-tap-hint-seen";

/** Starts true so the server render and the first paint never show a hint that may be stale. */
export const entryHint = $state({ seen: true });

export function loadEntryHint(): void {
  entryHint.seen = readStored(KEY) === "1";
}

export function markEntryHintSeen(): void {
  entryHint.seen = true;
  writeStored(KEY, "1");
}

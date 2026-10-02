/** Whether this browser has learned that a briefing entry opens when tapped. Per-device, so it is
 *  only a convenience: storage can be empty or blocked, and the page reads fine either way. */
const KEY = "pidra:entry-tap-hint-seen";

/** Starts true so the server render and the first paint never show a hint that may be stale. */
export const entryHint = $state({ seen: true });

export function loadEntryHint(): void {
  try {
    entryHint.seen = localStorage.getItem(KEY) === "1";
  } catch {
    entryHint.seen = false;
  }
}

export function markEntryHintSeen(): void {
  entryHint.seen = true;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Nothing to do: the hint comes back next visit.
  }
}

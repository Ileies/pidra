/**
 * localStorage that never throws. Private windows, blocked site data and the server render all
 * make it unavailable, and every use here is a per-device convenience (a remembered tab, a
 * theme, an unsent draft), so a failed read is "nothing stored" and a failed write is ignored.
 */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `null` removes the key. */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the value lasts for this visit only.
  }
}

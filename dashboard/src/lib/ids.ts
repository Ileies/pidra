/**
 * Extraction id parsing/validation. Pulled out of `#lib/server/extractions.ts` (server-only, so
 * SvelteKit refuses to bundle it into client code) because the offline detail page's `+page.ts`
 * needs the same regex to validate the `[ids]` param without importing anything server-side.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most ten: a report entry anchors one or two, and the URL form is user-editable. */
export function parseIds(raw: string): string[] {
  return raw.split(",").filter((id) => UUID_RE.test(id)).slice(0, 10);
}

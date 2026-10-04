/**
 * Id and day-key validation, shared with the backend. Kept as a `#lib` entry point because the
 * offline detail page's `+page.ts` needs it to validate the `[ids]` param without importing
 * anything server-side (`#lib/server/extractions.ts` is server-only).
 */

import { isUuid } from "$pipeline/util/ids";

export { UUID_RE, DATE_RE, isUuid, isDateKey } from "$pipeline/util/ids";

/** At most ten: a report entry anchors one or two, and the URL form is user-editable. */
export function parseIds(raw: string): string[] {
  return raw.split(",").filter(isUuid).slice(0, 10);
}

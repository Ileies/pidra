/** Shape checks for ids and day keys that arrive from a client, a model or a URL. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** `YYYY-MM-DD` in shape only; `isLocalDate` in `util/time` also rejects 2026-02-31. */
export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

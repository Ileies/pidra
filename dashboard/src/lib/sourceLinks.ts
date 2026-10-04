import { isDateKey } from "$pipeline/util/ids";

/** Keep a source delivery link usable even if a database date arrives as a Date object. */
export function sourceItemDetailHref(runDate: string | Date, id: string): string {
  const date = runDate instanceof Date ? runDate.toISOString().slice(0, 10) : runDate;
  if (!isDateKey(date)) throw new Error(`Invalid source delivery date: ${date}`);
  return `/${date}/detail/${encodeURIComponent(id)}`;
}

/** Keep a source delivery link usable even if a database date arrives as a Date object. */
export function sourceItemDetailHref(runDate: string | Date, id: string): string {
  const date = runDate instanceof Date ? runDate.toISOString().slice(0, 10) : runDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid source delivery date: ${date}`);
  return `/${date}/detail/${encodeURIComponent(id)}`;
}

/** The JSON in each row's `rawContent`; a row that is empty or not valid JSON is skipped. */
export function parseJsonRows<T>(rows: { rawContent: string | null }[]): T[] {
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.rawContent ?? "") as T];
    } catch {
      return [];
    }
  });
}

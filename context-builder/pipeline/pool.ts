/**
 * Runs `worker` over `items` with at most `limit` in flight. Workers pull from a shared cursor,
 * so a slow item never idles the rest of the pool. `worker` must not throw - handle per-item
 * failures inside it, or one rejection tears down the whole pool.
 */
export async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}


export async function mapWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.floor(limit) || 1);
  let nextIndex = 0;
  const workerCount = Math.min(effectiveLimit, items.length);
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < workerCount; w += 1) {
    workers.push(
      (async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          await fn(items[index]!);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

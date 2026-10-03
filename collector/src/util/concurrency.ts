/** Minimal promise pool: limits concurrent API calls without extra dependencies. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

/** Caches a promise per key so repositories shared between projects are fetched once. */
export function memoize<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  let hit = cache.get(key);
  if (!hit) {
    hit = task();
    cache.set(key, hit);
  }
  return hit;
}

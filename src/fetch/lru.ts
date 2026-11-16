/** A bounded map that drops the least recently used entry once it is full. */
interface Lru<K, V> {
  /** Read a value and mark it as the most recently used. */
  get(key: K): V | undefined;
  /** Store a value as the most recently used, evicting the oldest entry when full. */
  set(key: K, value: V): void;
  /** Change the capacity, dropping the oldest entries until the new limit is met. */
  setLimit(limit: number): void;
}

/**
 * Build a least-recently-used cache. `onEvict` runs for every entry the cache drops itself:
 * capacity overflow, a shrinking `setLimit`, and inserts into a zero-capacity cache.
 */
export function createLru<K, V>(limit: number, onEvict?: (value: V, key: K) => void): Lru<K, V> {
  const entries = new Map<K, V>();
  let capacity = limit;

  const drop = (key: K, value: V): void => {
    entries.delete(key);
    onEvict?.(value, key);
  };

  const trim = (): void => {
    while (entries.size > capacity) {
      const oldest = entries.entries().next().value;
      if (!oldest) {
        return;
      }
      drop(oldest[0], oldest[1]);
    }
  };

  return {
    get(key) {
      if (!entries.has(key)) {
        return undefined;
      }
      const value = entries.get(key) as V;
      // Re-insert so the key moves to the newest end of the Map's insertion order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      if (capacity < 1) {
        onEvict?.(value, key);
        return;
      }
      if (entries.size >= capacity) {
        const oldest = entries.entries().next().value;
        if (oldest) {
          drop(oldest[0], oldest[1]);
        }
      }
      entries.set(key, value);
    },
    setLimit(next) {
      capacity = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
      trim();
    },
  };
}

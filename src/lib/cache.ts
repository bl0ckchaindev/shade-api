/**
 * Simple in-memory TTL cache for config and merkle state
 */

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export function createCache<T>(ttlMs: number) {
  const store = new Map<string, CacheEntry<T>>();

  function get(key: string): T | undefined {
    const entry = store.get(key);
    if (!entry || Date.now() > entry.expires) {
      if (entry) store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key: string, value: T): void {
    store.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }

  return { get, set };
}

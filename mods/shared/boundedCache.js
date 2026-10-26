// Size-capped cache with first-in, first-out eviction. Backed by Map, so keys
// such as video IDs can never collide with Object.prototype names.
export function createBoundedCache(maxEntries) {
  const map = new Map();
  return {
    get(key) {
      return map.get(key);
    },
    has(key) {
      return map.has(key);
    },
    // Updating an existing key keeps its original position (FIFO, not LRU).
    set(key, value) {
      map.set(key, value);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
      return value;
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

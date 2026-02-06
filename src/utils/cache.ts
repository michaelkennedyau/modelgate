/**
 * ModelGate — LRU Cache
 *
 * A simple, zero-dependency Least Recently Used cache.
 * Uses a Map (insertion-ordered in JS) for O(1) get/set/delete.
 * On get(), the entry is deleted and re-inserted to move it to the end.
 * On set(), if at capacity, the first (oldest) entry is deleted.
 */

export class LRUCache<K, V> {
  private readonly map: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error("LRUCache maxSize must be at least 1");
    }
    this.maxSize = maxSize;
    this.map = new Map();
  }

  /**
   * Retrieve a value by key. Promotes the entry to most-recently-used.
   * Returns undefined if the key is not in the cache.
   */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    // Delete and re-insert to move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * Insert or update a key-value pair. If at capacity, evicts the oldest entry.
   */
  set(key: K, value: V): void {
    // If key already exists, delete it first so re-insert goes to end
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict the oldest entry (first key in the Map)
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  /**
   * Check if a key exists in the cache. Does NOT promote the entry.
   */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Current number of entries in the cache.
   */
  get size(): number {
    return this.map.size;
  }
}

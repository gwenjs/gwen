/**
 * Bounded LRU cache backed by a single Map.
 *
 * Map insertion order is used as the LRU queue — the first inserted entry is
 * the least-recently-used. On get/set, the entry is deleted and re-inserted to
 * move it to the tail (MRU position). On eviction, the Map's first key is removed.
 */
export class LRUMap<K, V> {
  private readonly _map = new Map<K, V>();

  constructor(private readonly _max: number) {}

  get(key: K): V | undefined {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._max) {
      this._map.delete(this._map.keys().next().value!);
    }
    this._map.set(key, val);
  }

  has(key: K): boolean {
    return this._map.has(key);
  }
  clear(): void {
    this._map.clear();
  }
  get size(): number {
    return this._map.size;
  }
}

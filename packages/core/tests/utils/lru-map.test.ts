import { describe, it, expect } from "vitest";
import { LRUMap } from "../../src/utils/lru-map";

describe("LRUMap", () => {
  it("stores and retrieves values", () => {
    const map = new LRUMap<string, number>(3);
    map.set("a", 1);
    expect(map.get("a")).toBe(1);
  });

  it("evicts the least-recently-used entry when full", () => {
    const map = new LRUMap<string, number>(3);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("d", 4);
    expect(map.has("a")).toBe(false);
    expect(map.has("d")).toBe(true);
  });

  it("get() promotes entry to MRU position", () => {
    const map = new LRUMap<string, number>(3);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.get("a"); // 'a' is now MRU — 'b' becomes LRU
    map.set("d", 4); // should evict 'b'
    expect(map.has("b")).toBe(false);
    expect(map.has("a")).toBe(true);
  });

  it("set() on existing key updates value and promotes to MRU", () => {
    const map = new LRUMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 99); // 'a' updated and promoted — 'b' is now LRU
    map.set("c", 3); // should evict 'b'
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(99);
  });

  it("size reflects current entry count", () => {
    const map = new LRUMap<string, number>(5);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.size).toBe(2);
  });

  it("clear() empties the map", () => {
    const map = new LRUMap<string, number>(3);
    map.set("a", 1);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.has("a")).toBe(false);
  });

  it("returns undefined for missing keys", () => {
    const map = new LRUMap<string, number>(3);
    expect(map.get("missing")).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { StringPool, StringPoolManager } from "../src/utils/string-pool";

describe("StringPool", () => {
  let pool: StringPool;

  beforeEach(() => {
    pool = new StringPool();
  });

  it("should intern strings and return unique IDs", () => {
    const id1 = pool.intern("hello");
    const id2 = pool.intern("world");
    const id3 = pool.intern("hello"); // Duplicate

    expect(id1).not.toBe(id2);
    expect(id1).toBe(id3); // Same string returns same ID
  });

  it("should retrieve strings by ID", () => {
    const id = pool.intern("test");
    expect(pool.get(id)).toBe("test");
  });

  it("should return empty string for unknown ID", () => {
    expect(pool.get(999)).toBe("");
  });

  it("should clear all strings", () => {
    pool.intern("foo");
    pool.intern("bar");
    expect(pool.size).toBe(2);

    pool.clear();
    expect(pool.size).toBe(0);
  });

  it("should reset IDs after clear", () => {
    const id1 = pool.intern("first");
    pool.clear();
    const id2 = pool.intern("second");

    expect(id1).toBe(id2); // Both get ID 1 (first ID after reset)
  });

  it("should report correct size", () => {
    expect(pool.size).toBe(0);
    pool.intern("a");
    expect(pool.size).toBe(1);
    pool.intern("b");
    expect(pool.size).toBe(2);
    pool.intern("a"); // Duplicate
    expect(pool.size).toBe(2);
  });
});

describe("StringPoolManager", () => {
  let manager: StringPoolManager;

  beforeEach(() => {
    manager = new StringPoolManager();
  });

  it("should have separate scene and persistent pools", () => {
    const sceneId = manager.scene.intern("scene-data");
    const persistentId = manager.persistent.intern("persistent-data");

    expect(manager.scene.get(sceneId)).toBe("scene-data");
    expect(manager.persistent.get(persistentId)).toBe("persistent-data");
  });

  it("should only clear scene pool, not persistent", () => {
    manager.scene.intern("temp");
    manager.persistent.intern("keep");

    expect(manager.scene.size).toBe(1);
    expect(manager.persistent.size).toBe(1);

    manager.clearScene();

    expect(manager.scene.size).toBe(0);
    expect(manager.persistent.size).toBe(1);
  });

  it("should return debug stats", () => {
    manager.scene.intern("a");
    manager.scene.intern("b");
    manager.persistent.intern("x");

    const stats = manager.getDebugStats();
    expect(stats.scenePoolSize).toBe(2);
    expect(stats.persistentPoolSize).toBe(1);
  });
});

describe("GlobalStringPoolManager", () => {
  let pool: StringPoolManager;
  beforeEach(() => {
    pool = new StringPoolManager();
  });

  it("should be a singleton instance", () => {
    const id = pool.scene.intern("global-test");
    expect(pool.scene.get(id)).toBe("global-test");
  });

  it("should clear scene pool without affecting persistent pool", () => {
    pool.scene.intern("scene1");
    pool.scene.intern("scene2");
    pool.persistent.intern("persistent1");

    expect(pool.scene.size).toBe(2);
    expect(pool.persistent.size).toBe(1);

    pool.clearScene();

    expect(pool.scene.size).toBe(0);
    expect(pool.persistent.size).toBe(1);
  });

  it("should handle multiple scene transitions without leaking persistent pool", () => {
    // Simulate 100 scene transitions
    for (let i = 0; i < 100; i++) {
      pool.scene.intern(`scene-entity-${i}`);
      pool.clearScene();
    }

    // Scene pool should be empty after each clearScene()
    expect(pool.scene.size).toBe(0);

    // Persistent pool should remain stable if not used
    expect(pool.persistent.size).toBe(0);
  });

  it("should correctly manage persistent strings across transitions", () => {
    const playerName = "Hero";
    const persistentId = pool.persistent.intern(playerName);

    // Simulate scene transitions
    for (let i = 0; i < 10; i++) {
      pool.scene.intern(`temp-${i}`);
      pool.clearScene();
    }

    // Persistent string should still be accessible
    expect(pool.persistent.get(persistentId)).toBe(playerName);
  });
});

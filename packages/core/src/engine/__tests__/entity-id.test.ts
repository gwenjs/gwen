/**
 * Unit tests for EntityId — 64-bit opaque entity handle with nominal branding.
 *
 * Test coverage:
 * - createEntityId / unpackEntityId round-trip
 * - Edge cases (min/max values, u32 boundaries)
 * - Regression: 4096-generation collision bug
 * - Serialization (string encoding/decoding)
 * - Error handling (invalid strings)
 * - Stress test (1M random pairs)
 */

import { describe, it, expect } from 'vitest';
import {
  createEntityId,
  unpackEntityId,
  entityIdEqual,
  entityIdToString,
  entityIdFromString,
  type EntityId,
} from '../engine-api';

describe('EntityId (64-bit BigInt with brand)', () => {
  describe('createEntityId', () => {
    it('should create EntityId from index and generation', () => {
      const id = createEntityId(5, 100);
      expect(typeof id).toBe('bigint');
    });

    it('should preserve zero values', () => {
      const id = createEntityId(0, 0);
      const { index, generation } = unpackEntityId(id);
      expect(index).toBe(0);
      expect(generation).toBe(0);
    });

    it('should preserve maximum u32 generation', () => {
      const maxGen = 4_294_967_295; // 2^32 - 1
      const id = createEntityId(10, maxGen);
      const { generation } = unpackEntityId(id);
      expect(generation).toBe(maxGen);
    });

    it('should preserve maximum u32 index', () => {
      const maxIdx = 4_294_967_295; // 2^32 - 1
      const id = createEntityId(maxIdx, 50);
      const { index } = unpackEntityId(id);
      expect(index).toBe(maxIdx);
    });

    it('should handle both max values simultaneously', () => {
      const maxVal = 4_294_967_295;
      const id = createEntityId(maxVal, maxVal);
      const { index, generation } = unpackEntityId(id);
      expect(index).toBe(maxVal);
      expect(generation).toBe(maxVal);
    });

    it('should distinguish same-index different-generation IDs (4096 regression test)', () => {
      // Before fix: generation 4096 would be truncated to 0 (12-bit limit)
      // This would cause: ID(5, 0) === ID(5, 4096)
      const id1 = createEntityId(5, 0);
      const id2 = createEntityId(5, 4096);

      expect(id1).not.toBe(id2);

      const { generation: g1 } = unpackEntityId(id1);
      const { generation: g2 } = unpackEntityId(id2);
      expect(g1).toBe(0);
      expect(g2).toBe(4096);
    });

    it('should distinguish same-index IDs across generation boundaries', () => {
      const boundary = 4_294_967_295;
      const id1 = createEntityId(5, boundary - 1);
      const id2 = createEntityId(5, boundary);

      expect(id1).not.toBe(id2);
    });
  });

  describe('unpackEntityId', () => {
    it('should round-trip correctly', () => {
      const original = { index: 123, generation: 456 };
      const id = createEntityId(original.index, original.generation);
      const unpacked = unpackEntityId(id);
      expect(unpacked).toEqual(original);
    });

    it('should handle zero values', () => {
      const original = { index: 0, generation: 0 };
      const id = createEntityId(original.index, original.generation);
      const unpacked = unpackEntityId(id);
      expect(unpacked).toEqual(original);
    });

    it('should handle max values', () => {
      const maxVal = 4_294_967_295;
      const original = { index: maxVal, generation: maxVal };
      const id = createEntityId(original.index, original.generation);
      const unpacked = unpackEntityId(id);
      expect(unpacked).toEqual(original);
    });

    it('should preserve all unique (index, generation) combinations', () => {
      const testCases = [
        { index: 0, generation: 0 },
        { index: 1, generation: 0 },
        { index: 0, generation: 1 },
        { index: 1_000_000, generation: 5_000_000 },
        { index: 4_294_967_295, generation: 4_294_967_295 },
        { index: 5, generation: 4096 }, // 4096 regression case
      ];

      for (const original of testCases) {
        const id = createEntityId(original.index, original.generation);
        const unpacked = unpackEntityId(id);
        expect(unpacked).toEqual(original);
      }
    });
  });

  describe('entityIdEqual', () => {
    it('should return true for equal IDs', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(5, 10);
      expect(entityIdEqual(id1, id2)).toBe(true);
    });

    it('should return false for different IDs (different index)', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(6, 10);
      expect(entityIdEqual(id1, id2)).toBe(false);
    });

    it('should return false for different IDs (different generation)', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(5, 11);
      expect(entityIdEqual(id1, id2)).toBe(false);
    });

    it('should return false for completely different IDs', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(100, 5000);
      expect(entityIdEqual(id1, id2)).toBe(false);
    });

    it('should be consistent across multiple comparisons', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(5, 10);
      const id3 = createEntityId(5, 10);

      expect(entityIdEqual(id1, id2)).toBe(true);
      expect(entityIdEqual(id2, id3)).toBe(true);
      expect(entityIdEqual(id1, id3)).toBe(true);
    });
  });

  describe('entityIdToString / entityIdFromString', () => {
    it('should serialize to string', () => {
      const id = createEntityId(5, 42);
      const str = entityIdToString(id);
      expect(str).toBe('5:42');
    });

    it('should serialize zero values', () => {
      const id = createEntityId(0, 0);
      const str = entityIdToString(id);
      expect(str).toBe('0:0');
    });

    it('should serialize max values', () => {
      const maxVal = 4_294_967_295;
      const id = createEntityId(maxVal, maxVal);
      const str = entityIdToString(id);
      expect(str).toBe(`${maxVal}:${maxVal}`);
    });

    it('should deserialize from string', () => {
      const original = createEntityId(5, 42);
      const str = entityIdToString(original);
      const restored = entityIdFromString(str);
      expect(entityIdEqual(original, restored)).toBe(true);
    });

    it('should round-trip correctly', () => {
      const testCases = [
        { index: 0, generation: 0 },
        { index: 5, generation: 42 },
        { index: 1_000_000, generation: 5_000_000 },
        { index: 4_294_967_295, generation: 4_294_967_295 },
      ];

      for (const original of testCases) {
        const id = createEntityId(original.index, original.generation);
        const str = entityIdToString(id);
        const restored = entityIdFromString(str);
        const unpacked = unpackEntityId(restored);
        expect(unpacked).toEqual(original);
      }
    });

    it('should throw on invalid format (missing colon)', () => {
      expect(() => entityIdFromString('5,42')).toThrow();
      expect(() => entityIdFromString('542')).toThrow();
    });

    it('should throw on non-numeric values', () => {
      expect(() => entityIdFromString('abc:def')).toThrow();
      expect(() => entityIdFromString('5:abc')).toThrow();
    });

    it('should throw on empty string', () => {
      expect(() => entityIdFromString('')).toThrow();
    });

    it('should throw on malformed format', () => {
      expect(() => entityIdFromString(':')).toThrow();
      expect(() => entityIdFromString('5:')).toThrow();
      expect(() => entityIdFromString(':42')).toThrow();
    });
  });

  describe('Stress test: 100k random (index, generation) pairs', () => {
    it('should round-trip 100k random pairs without loss', () => {
      for (let i = 0; i < 100_000; i++) {
        const index = Math.floor(Math.random() * 4_294_967_295);
        const generation = Math.floor(Math.random() * 4_294_967_295);

        const id = createEntityId(index, generation);
        const { index: idx, generation: gen } = unpackEntityId(id);

        expect(idx).toBe(index);
        expect(gen).toBe(generation);
      }
    }, 30_000);
  });

  describe('Type safety (compile-time checks)', () => {
    it('should create EntityId that compiles as bigint', () => {
      const id = createEntityId(5, 10);
      const isBigInt = typeof id === 'bigint';
      expect(isBigInt).toBe(true);
    });

    it('should allow EntityId to be used as Map key', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(5, 10);
      const map = new Map<EntityId, string>();

      map.set(id1, 'value1');
      // Using same value should retrieve
      expect(map.get(id2)).toBe('value1');
    });

    it('should work with Set', () => {
      const id1 = createEntityId(5, 10);
      const id2 = createEntityId(5, 10);
      const id3 = createEntityId(5, 11);

      const set = new Set<EntityId>();
      set.add(id1);
      set.add(id2); // Duplicate
      set.add(id3);

      expect(set.size).toBe(2); // id1 and id2 are the same
    });
  });

  describe('Edge cases and bit boundaries', () => {
    it('should handle single-bit values', () => {
      const id = createEntityId(1, 1);
      const { index, generation } = unpackEntityId(id);
      expect(index).toBe(1);
      expect(generation).toBe(1);
    });

    it('should handle power-of-two boundaries', () => {
      const powers = [
        { index: 2 ** 16, generation: 2 ** 16 },
        { index: 2 ** 24, generation: 2 ** 24 },
        { index: 2 ** 30, generation: 2 ** 30 },
      ];

      for (const { index, generation } of powers) {
        const id = createEntityId(index, generation);
        const unpacked = unpackEntityId(id);
        expect(unpacked.index).toBe(index);
        expect(unpacked.generation).toBe(generation);
      }
    });

    it('should maintain uniqueness across bit boundaries', () => {
      const ids = new Set<EntityId>();

      // Add IDs that might collide if bit packing is incorrect
      ids.add(createEntityId(1, 0));
      ids.add(createEntityId(0, 1));
      ids.add(createEntityId(2, 0));
      ids.add(createEntityId(0, 2));

      expect(ids.size).toBe(4); // All unique
    });
  });
});

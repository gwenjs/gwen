/**
 * Tests for EngineComponentRegistry cache optimization (P1-3)
 *
 * Validates that the entityTypeCache is correctly maintained and
 * eliminates O(N×M) WASM calls in getEntityTypeIds().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineComponentRegistry } from '../src/engine/engine-component-registry';
import { createEntityId } from '../src/types/entity';
import type { WasmBridge } from '../src/engine/wasm-bridge';

describe('EngineComponentRegistry — entityTypeCache (P1-3)', () => {
  let registry: EngineComponentRegistry;
  let mockBridge: WasmBridge;

  beforeEach(() => {
    // Mock WasmBridge with minimal required methods
    mockBridge = {
      registerComponentType: vi.fn(() => Math.floor(Math.random() * 1000)),
      hasComponent: vi.fn(() => false), // Should NEVER be called with cache!
    } as unknown as WasmBridge;

    registry = new EngineComponentRegistry(mockBridge);
  });

  // ── trackAdd() tests ──────────────────────────────────────────────────────

  it('trackAdd adds a type to the cache', () => {
    const slotIndex = 0;
    const typeId = 42;

    registry.trackAdd(slotIndex, typeId);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([42]);
  });

  it('trackAdd supports multiple types on same entity', () => {
    const slotIndex = 5;

    registry.trackAdd(slotIndex, 10);
    registry.trackAdd(slotIndex, 20);
    registry.trackAdd(slotIndex, 30);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toHaveLength(3);
    expect(types).toContain(10);
    expect(types).toContain(20);
    expect(types).toContain(30);
  });

  it('trackAdd is idempotent (no duplicates)', () => {
    const slotIndex = 3;
    const typeId = 99;

    registry.trackAdd(slotIndex, typeId);
    registry.trackAdd(slotIndex, typeId); // Add again
    registry.trackAdd(slotIndex, typeId); // Add again

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([99]); // Only one occurrence
  });

  // ── trackRemove() tests ───────────────────────────────────────────────────

  it('trackRemove removes a type from the cache', () => {
    const slotIndex = 1;

    registry.trackAdd(slotIndex, 100);
    registry.trackAdd(slotIndex, 200);
    registry.trackRemove(slotIndex, 100);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([200]);
  });

  it('trackRemove on non-existent type is safe (no-op)', () => {
    const slotIndex = 2;

    registry.trackAdd(slotIndex, 50);
    registry.trackRemove(slotIndex, 999); // Type not in cache

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([50]); // Unchanged
  });

  it('trackRemove cleans up empty cache entries', () => {
    const slotIndex = 7;

    registry.trackAdd(slotIndex, 77);
    registry.trackRemove(slotIndex, 77); // Last type removed

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([]); // Empty, not undefined
  });

  // ── getEntityTypeIds() cache behavior ─────────────────────────────────────

  it('getEntityTypeIds returns empty array for uncached entity', () => {
    const entityId = createEntityId(999, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([]);
  });

  it('getEntityTypeIds NEVER calls hasComponent (cache hit)', () => {
    const slotIndex = 10;

    // Register some component types
    registry.getOrRegister('Transform');
    registry.getOrRegister('Velocity');
    registry.getOrRegister('Health');

    // Track components on entity
    registry.trackAdd(slotIndex, 1);
    registry.trackAdd(slotIndex, 2);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toHaveLength(2);
    // Critical: hasComponent should NEVER be called with cache
    expect(mockBridge.hasComponent).not.toHaveBeenCalled();
  });

  // ── clearEntityCache() tests ──────────────────────────────────────────────

  it('clearEntityCache removes all types for an entity', () => {
    const slotIndex = 15;

    registry.trackAdd(slotIndex, 1);
    registry.trackAdd(slotIndex, 2);
    registry.trackAdd(slotIndex, 3);

    registry.clearEntityCache(slotIndex);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toEqual([]);
  });

  it('clearEntityCache on non-existent entry is safe', () => {
    expect(() => {
      registry.clearEntityCache(9999);
    }).not.toThrow();
  });

  // ── Integration: realistic scenario ───────────────────────────────────────

  it('realistic scenario: 500 entities × 3 components', () => {
    // Simulate 500 entities each with Transform, Velocity, Sprite
    const transformId = registry.getOrRegister('Transform');
    const velocityId = registry.getOrRegister('Velocity');
    const spriteId = registry.getOrRegister('Sprite');

    for (let i = 0; i < 500; i++) {
      registry.trackAdd(i, transformId);
      registry.trackAdd(i, velocityId);
      registry.trackAdd(i, spriteId);
    }

    // Verify entity 250 has all 3 components
    const entityId = createEntityId(250, 0);
    const types = registry.getEntityTypeIds(entityId);

    expect(types).toHaveLength(3);
    expect(types).toContain(transformId);
    expect(types).toContain(velocityId);
    expect(types).toContain(spriteId);

    // Critical: no WASM calls made
    expect(mockBridge.hasComponent).not.toHaveBeenCalled();
  });

  // ── Performance validation ────────────────────────────────────────────────

  it('getEntityTypeIds is O(1) — constant time regardless of registered types', () => {
    const slotIndex = 42;

    // Register 100 different component types
    for (let i = 0; i < 100; i++) {
      registry.getOrRegister(`Component${i}`);
    }

    // Entity only has 2 components
    registry.trackAdd(slotIndex, 5);
    registry.trackAdd(slotIndex, 10);

    const entityId = createEntityId(slotIndex, 0);
    const types = registry.getEntityTypeIds(entityId);

    // Should return only the 2 tracked types, not loop through all 100
    expect(types).toEqual([5, 10]);

    // Verify hasComponent was NEVER called (no O(N) loop)
    expect(mockBridge.hasComponent).not.toHaveBeenCalled();
  });
});

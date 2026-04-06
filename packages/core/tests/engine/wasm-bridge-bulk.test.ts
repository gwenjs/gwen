import { describe, it, expect, vi } from 'vitest';
import type { WasmBridge } from '../../src/engine/wasm-bridge';

/**
 * Minimal WasmBridge mock for testing the TypeScript API surface.
 * We test the contract, not the WASM internals.
 */
function makeMockBridge(overrides: Partial<WasmBridge> = {}): WasmBridge {
  return {
    isActive: vi.fn().mockReturnValue(true),
    variant: 'light',
    hasPhysics: vi.fn().mockReturnValue(false),
    getPhysicsBridge: vi.fn(),
    engine: vi.fn(),
    createEntity: vi.fn(),
    deleteEntity: vi.fn(),
    isAlive: vi.fn(),
    countEntities: vi.fn(),
    registerComponentType: vi.fn(),
    addComponent: vi.fn(),
    removeComponent: vi.fn(),
    hasComponent: vi.fn(),
    getComponentRaw: vi.fn(),
    readComponentsBulk: vi.fn(),
    writeComponentsBulk: vi.fn(),
    updateEntityArchetype: vi.fn(),
    removeEntityFromQuery: vi.fn(),
    queryEntities: vi.fn(),
    queryEntitiesRaw: vi.fn(),
    forEachQueryResultRaw: vi.fn(),
    getEntityGeneration: vi.fn(),
    tick: vi.fn(),
    allocSharedBuffer: vi.fn(),
    syncTransformsToBuffer: vi.fn(),
    syncTransformsToBufferSparse: vi.fn(),
    dirtyTransformCount: vi.fn(),
    clearTransformDirty: vi.fn(),
    syncTransformsFromBuffer: vi.fn(),
    getLinearMemory: vi.fn(),
    checkMemoryGrow: vi.fn(),
    stats: vi.fn(),
    queryReadBulk: vi.fn().mockReturnValue({
      entityCount: 0,
      data: new Float32Array(0),
      slots: new Uint32Array(0),
      gens: new Uint32Array(0),
    }),
    queryWriteBulk: vi.fn(),
    ...overrides,
  } as unknown as WasmBridge;
}

describe('WasmBridge.queryReadBulk', () => {
  it('returns entityCount 0 when no entities match', () => {
    const bridge = makeMockBridge();
    const result = bridge.queryReadBulk([1], 1, 4);
    expect(result.entityCount).toBe(0);
    expect(result.data.length).toBe(0);
  });

  it('returns a Float32Array with f32Stride × entityCount elements', () => {
    const bridge = makeMockBridge({
      queryReadBulk: vi.fn().mockReturnValue({
        entityCount: 3,
        data: new Float32Array(6), // 3 entities × stride 2
        slots: new Uint32Array(3),
        gens: new Uint32Array(3),
      }),
    });
    const result = bridge.queryReadBulk([1], 1, 2);
    expect(result.data.length).toBe(6);
    expect(result.entityCount).toBe(3);
  });

  it('returns slots and gens arrays of length entityCount', () => {
    const bridge = makeMockBridge({
      queryReadBulk: vi.fn().mockReturnValue({
        entityCount: 2,
        data: new Float32Array(4),
        slots: new Uint32Array(2),
        gens: new Uint32Array(2),
      }),
    });
    const result = bridge.queryReadBulk([1, 2], 1, 2);
    expect(result.slots.length).toBe(2);
    expect(result.gens.length).toBe(2);
  });

  it('handles multiple component type IDs in filter', () => {
    const readFn = vi.fn().mockReturnValue({
      entityCount: 1,
      data: new Float32Array(3),
      slots: new Uint32Array(1),
      gens: new Uint32Array(1),
    });
    const bridge = makeMockBridge({
      queryReadBulk: readFn,
    });
    const result = bridge.queryReadBulk([1, 2, 3], 4, 3);
    expect(readFn).toHaveBeenCalledWith([1, 2, 3], 4, 3);
    expect(result.entityCount).toBe(1);
  });

  it('handles large stride values', () => {
    const bridge = makeMockBridge({
      queryReadBulk: vi.fn().mockReturnValue({
        entityCount: 2,
        data: new Float32Array(32), // 2 entities × stride 16
        slots: new Uint32Array(2),
        gens: new Uint32Array(2),
      }),
    });
    const result = bridge.queryReadBulk([1], 1, 16);
    expect(result.data.length).toBe(32);
    expect(result.entityCount).toBe(2);
  });
});

describe('WasmBridge.queryWriteBulk', () => {
  it('does not throw with empty entity set', () => {
    const bridge = makeMockBridge();
    expect(() =>
      bridge.queryWriteBulk(new Uint32Array(0), new Uint32Array(0), 1, new Float32Array(0)),
    ).not.toThrow();
  });

  it('is called with correct args', () => {
    const writeFn = vi.fn();
    const bridge = makeMockBridge({ queryWriteBulk: writeFn });
    const slots = new Uint32Array([1, 2]);
    const gens = new Uint32Array([0, 0]);
    const data = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    bridge.queryWriteBulk(slots, gens, 5, data);
    expect(writeFn).toHaveBeenCalledWith(slots, gens, 5, data);
  });

  it('handles single entity write', () => {
    const writeFn = vi.fn();
    const bridge = makeMockBridge({ queryWriteBulk: writeFn });
    const slots = new Uint32Array([42]);
    const gens = new Uint32Array([3]);
    const data = new Float32Array([1.5, 2.5, 3.5]);
    bridge.queryWriteBulk(slots, gens, 7, data);
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(slots, gens, 7, data);
  });

  it('handles large batches', () => {
    const writeFn = vi.fn();
    const bridge = makeMockBridge({ queryWriteBulk: writeFn });
    const n = 5000;
    const slots = new Uint32Array(n);
    const gens = new Uint32Array(n);
    const data = new Float32Array(n * 2); // 2 floats per entity
    for (let i = 0; i < n; i++) {
      slots[i] = i;
      gens[i] = 0;
    }
    bridge.queryWriteBulk(slots, gens, 10, data);
    expect(writeFn).toHaveBeenCalledWith(slots, gens, 10, data);
  });
});

describe('WasmBridge.queryReadBulk + queryWriteBulk roundtrip', () => {
  it('can read and write back in sequence', () => {
    const readData = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const readSlots = new Uint32Array([0, 1]);
    const readGens = new Uint32Array([0, 0]);

    const readFn = vi.fn().mockReturnValue({
      entityCount: 2,
      data: readData,
      slots: readSlots,
      gens: readGens,
    });
    const writeFn = vi.fn();

    const bridge = makeMockBridge({
      queryReadBulk: readFn,
      queryWriteBulk: writeFn,
    });

    // Read phase
    const readResult = bridge.queryReadBulk([1], 1, 2);
    expect(readResult.entityCount).toBe(2);

    // Modify data
    readResult.data[0] = 10.0;
    readResult.data[1] = 20.0;

    // Write back
    bridge.queryWriteBulk(readResult.slots, readResult.gens, 1, readResult.data);

    expect(writeFn).toHaveBeenCalledWith(readSlots, readGens, 1, readResult.data);
  });
});

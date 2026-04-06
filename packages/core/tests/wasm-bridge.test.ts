/**
 * WasmBridge tests
 *
 * WASM is mandatory — bridge methods throw if not initialized.
 * Tests with a mock use _injectMockWasmEngine().
 *
 * Coverage:
 *   - Uninitialized bridge throws on all methods
 *   - Initialized bridge (mock) delegates correctly
 *   - SAB methods: allocSharedBuffer, syncTransformsToBuffer, syncTransformsFromBuffer
 *   - getLinearMemory() returns null with mock, live WebAssembly.Memory with real module
 *   - Singleton identity and reset
 *   - Engine integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWasmBridge,
  _injectMockWasmEngine,
  _injectMockWasmExports,
  _resetWasmBridge,
  type WasmBridge,
  type WasmEngine,
  type WasmEntityId,
} from '../src/engine/wasm-bridge';

// ── Mock helper ───────────────────────────────────────────────────────────────

function createMockEngine(): WasmEngine {
  return {
    create_entity: vi.fn((): WasmEntityId => ({ index: 0, generation: 0 })),
    delete_entity: vi.fn(() => true),
    is_alive: vi.fn(() => true),
    count_entities: vi.fn(() => 0),
    register_component_type: vi.fn(() => 0),
    add_component: vi.fn(() => true),
    remove_component: vi.fn(() => true),
    has_component: vi.fn(() => false),
    get_component_raw: vi.fn(() => new Uint8Array(0)),
    update_entity_archetype: vi.fn(),
    remove_entity_from_query: vi.fn(),
    query_entities: vi.fn(() => new Uint32Array(0)),
    query_entities_to_buffer: vi.fn(() => 0),
    get_query_result_ptr: vi.fn(() => 8192),
    get_entity_generation: vi.fn(() => 0),
    tick: vi.fn(),
    frame_count: vi.fn(() => BigInt(1)),
    delta_time: vi.fn(() => 0.016),
    total_time: vi.fn(() => 1.0),
    // SAB methods
    alloc_shared_buffer: vi.fn(() => 4096),
    sync_transforms_to_buffer: vi.fn(),
    sync_transforms_to_buffer_sparse: vi.fn(),
    dirty_transform_count: vi.fn(() => 0),
    clear_transform_dirty: vi.fn(),
    sync_transforms_from_buffer: vi.fn(),
    stats: vi.fn(() => '{"entities":0,"frame":1}'),
  } as WasmEngine;
}

// ── Without WASM (not initialized) ───────────────────────────────────────────

describe('WasmBridge — not initialized', () => {
  beforeEach(() => _resetWasmBridge());

  it('isActive() returns false', () => {
    expect(getWasmBridge().isActive()).toBe(false);
  });

  it('engine() throws', () => {
    expect(() => getWasmBridge().engine()).toThrow('WASM');
  });

  it('createEntity() throws', () => {
    expect(() => getWasmBridge().createEntity()).toThrow('WASM');
  });

  it('deleteEntity() throws', () => {
    expect(() => getWasmBridge().deleteEntity(0, 0)).toThrow('WASM');
  });

  it('isAlive() throws', () => {
    expect(() => getWasmBridge().isAlive(0, 0)).toThrow('WASM');
  });

  it('countEntities() throws', () => {
    expect(() => getWasmBridge().countEntities()).toThrow('WASM');
  });

  it('registerComponentType() throws', () => {
    expect(() => getWasmBridge().registerComponentType()).toThrow('WASM');
  });

  it('addComponent() throws', () => {
    expect(() => getWasmBridge().addComponent(0, 0, 0, new Uint8Array(4))).toThrow('WASM');
  });

  it('tick() throws', () => {
    expect(() => getWasmBridge().tick(16)).toThrow('WASM');
  });

  it('stats() throws', () => {
    expect(() => getWasmBridge().stats()).toThrow('WASM');
  });
});

// ── With injected mock ────────────────────────────────────────────────────────

describe('WasmBridge — with injected mock', () => {
  let bridge: WasmBridge;
  let mock: WasmEngine;

  beforeEach(() => {
    _resetWasmBridge();
    mock = createMockEngine();
    _injectMockWasmEngine(mock);
    bridge = getWasmBridge();
  });

  afterEach(() => _resetWasmBridge());

  it('isActive() returns true', () => {
    expect(bridge.isActive()).toBe(true);
  });

  it('engine() returns the mock', () => {
    expect(bridge.engine()).toBe(mock);
  });

  it('createEntity() delegates to mock', () => {
    const id = bridge.createEntity();
    expect(mock.create_entity).toHaveBeenCalled();
    expect(id).toEqual({ index: 0, generation: 0 });
  });

  it('deleteEntity() delegates to mock', () => {
    bridge.deleteEntity(0, 0);
    expect(mock.delete_entity).toHaveBeenCalledWith(0, 0);
  });

  it('isAlive() delegates to mock', () => {
    bridge.isAlive(0, 0);
    expect(mock.is_alive).toHaveBeenCalledWith(0, 0);
  });

  it('registerComponentType() delegates to mock', () => {
    const id = bridge.registerComponentType();
    expect(mock.register_component_type).toHaveBeenCalled();
    expect(id).toBe(0);
  });

  it('addComponent() delegates to mock', () => {
    const data = new Uint8Array([1, 2, 3]);
    bridge.addComponent(0, 0, 1, data);
    expect(mock.add_component).toHaveBeenCalledWith(0, 0, 1, data);
  });

  it('removeComponent() delegates to mock', () => {
    bridge.removeComponent(0, 0, 1);
    expect(mock.remove_component).toHaveBeenCalledWith(0, 0, 1);
  });

  it('hasComponent() delegates to mock', () => {
    bridge.hasComponent(0, 0, 1);
    expect(mock.has_component).toHaveBeenCalledWith(0, 0, 1);
  });

  it('getComponentRaw() delegates to mock', () => {
    bridge.getComponentRaw(0, 0, 1);
    expect(mock.get_component_raw).toHaveBeenCalledWith(0, 0, 1);
  });

  it('updateEntityArchetype() passes Uint32Array to mock', () => {
    bridge.updateEntityArchetype(0, [1, 2, 3]);
    expect(mock.update_entity_archetype).toHaveBeenCalledWith(0, new Uint32Array([1, 2, 3]));
  });

  it('queryEntities() returns packed EntityIds from mock', () => {
    (mock.query_entities as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Uint32Array([0, 1, 2]),
    );
    // get_entity_generation returns 0 for all → entityId = (0n << 32n) | BigInt(index)
    const result = bridge.queryEntities([0]);
    expect(result).toEqual([0n, 1n, 2n]); // generation=0 → entityId === BigInt(index)
  });

  it('queryEntitiesRaw() delegates to query_entities_to_buffer', () => {
    (mock.query_entities_to_buffer as ReturnType<typeof vi.fn>).mockReturnValueOnce(5);
    const count = bridge.queryEntitiesRaw([10, 20]);
    expect(mock.query_entities_to_buffer).toHaveBeenCalled();
    expect(count).toBe(5);

    // Verify typeIdBuffer was used (it should contain [10, 20])
    const callArg = (mock.query_entities_to_buffer as any).mock.calls[0][0];
    expect(callArg).toBeInstanceOf(Uint32Array);
    expect(Array.from(callArg)).toEqual([10, 20]);
  });

  it('forEachQueryResultRaw() iterates over static buffer', () => {
    const buf = new ArrayBuffer(100_000);
    const mockMemory = { buffer: buf } as WebAssembly.Memory;
    _injectMockWasmExports({ memory: mockMemory });

    // Mock query result: 3 entities with indices [100, 200, 300]
    (mock.query_entities_to_buffer as ReturnType<typeof vi.fn>).mockReturnValueOnce(3);
    (mock.get_query_result_ptr as ReturnType<typeof vi.fn>).mockReturnValueOnce(0);

    const view = new Uint32Array(buf, 0, 3);
    view[0] = 100;
    view[1] = 200;
    view[2] = 300;

    const results: number[] = [];
    bridge.forEachQueryResultRaw([10], (idx) => {
      results.push(idx);
    });

    expect(results).toEqual([100, 200, 300]);
    expect(mock.query_entities_to_buffer).toHaveBeenCalled();
  });

  it('forEachQueryResultRaw() handles memory grow by recreating the view', () => {
    const buf1 = new ArrayBuffer(100_000);
    const buf2 = new ArrayBuffer(200_000);
    const mockMemory = { buffer: buf1 } as any;
    _injectMockWasmExports({ memory: mockMemory });

    (mock.query_entities_to_buffer as ReturnType<typeof vi.fn>).mockReturnValue(1);
    (mock.get_query_result_ptr as ReturnType<typeof vi.fn>).mockReturnValue(0);

    // 1. Initial call
    new Uint32Array(buf1, 0, 1)[0] = 42;
    let result = 0;
    bridge.forEachQueryResultRaw([10], (idx) => (result = idx));
    expect(result).toBe(42);

    // 2. Grow
    mockMemory.buffer = buf2;
    new Uint32Array(buf2, 0, 1)[0] = 99;
    bridge.forEachQueryResultRaw([10], (idx) => (result = idx));
    expect(result).toBe(99);
  });

  it('tick() delegates to mock', () => {
    bridge.tick(16.5);
    expect(mock.tick).toHaveBeenCalledWith(16.5);
  });

  it('stats() returns mock stats string', () => {
    const s = bridge.stats();
    expect(s).toBe('{"entities":0,"frame":1}');
  });

  // ── SAB methods ──────────────────────────────────────────────────────────

  it('allocSharedBuffer() delegates to mock and returns the pointer', () => {
    const ptr = bridge.allocSharedBuffer(320_000);
    expect(mock.alloc_shared_buffer).toHaveBeenCalledWith(320_000);
    expect(ptr).toBe(4096); // value returned by the mock
  });

  it('allocSharedBuffer() with 0 bytes delegates to mock', () => {
    bridge.allocSharedBuffer(0);
    expect(mock.alloc_shared_buffer).toHaveBeenCalledWith(0);
  });

  it('syncTransformsToBuffer() delegates ptr and maxEntities to mock', () => {
    bridge.syncTransformsToBuffer(4096, 10_000);
    expect(mock.sync_transforms_to_buffer).toHaveBeenCalledWith(4096, 10_000);
  });

  it('syncTransformsFromBuffer() delegates ptr and maxEntities to mock', () => {
    bridge.syncTransformsFromBuffer(4096, 10_000);
    expect(mock.sync_transforms_from_buffer).toHaveBeenCalledWith(4096, 10_000);
  });

  it('syncTransformsToBuffer() and syncTransformsFromBuffer() pass different ptr values', () => {
    bridge.syncTransformsToBuffer(1024, 500);
    bridge.syncTransformsFromBuffer(2048, 500);
    expect(mock.sync_transforms_to_buffer).toHaveBeenCalledWith(1024, 500);
    expect(mock.sync_transforms_from_buffer).toHaveBeenCalledWith(2048, 500);
  });

  // ── getLinearMemory() ────────────────────────────────────────────────────

  it('getLinearMemory() returns null with a mock engine (no real WASM module)', () => {
    // _injectMockWasmEngine leaves _wasmModule null intentionally —
    // test environments must not depend on a real WebAssembly.Memory.
    expect(bridge.getLinearMemory()).toBeNull();
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────────

describe('WasmBridge — singleton', () => {
  it('getWasmBridge() always returns the same instance', () => {
    _resetWasmBridge();
    const a = getWasmBridge();
    const b = getWasmBridge();
    expect(a).toBe(b);
  });

  it('_resetWasmBridge() resets isActive() to false', () => {
    _injectMockWasmEngine(createMockEngine());
    expect(getWasmBridge().isActive()).toBe(true);
    _resetWasmBridge();
    expect(getWasmBridge().isActive()).toBe(false);
  });
});

// ── Engine integration ────────────────────────────────────────────────────────

// ── checkMemoryGrow() tests ───────────────────────────────────────────────────

describe('WasmBridge — checkMemoryGrow()', () => {
  afterEach(() => {
    _resetWasmBridge();
  });

  it('should return false on first call (initializes state)', () => {
    const buf1 = new ArrayBuffer(100);
    const mockMemory = { buffer: buf1 } as WebAssembly.Memory;

    _injectMockWasmExports({ memory: mockMemory });

    const bridge = getWasmBridge();
    expect(bridge.checkMemoryGrow()).toBe(false);
  });

  it('should return true when buffer reference changes', () => {
    const buf1 = new ArrayBuffer(100);
    const buf2 = new ArrayBuffer(200);
    const mockMemory = { buffer: buf1 } as any;

    _injectMockWasmExports({ memory: mockMemory });

    const bridge = getWasmBridge();
    bridge.checkMemoryGrow(); // initialise _lastMemoryBuffer = buf1

    // Simulate a grow
    mockMemory.buffer = buf2;
    expect(bridge.checkMemoryGrow()).toBe(true);
  });

  it('should return false if called twice without grow', () => {
    const buf1 = new ArrayBuffer(100);
    const mockMemory = { buffer: buf1 } as WebAssembly.Memory;

    _injectMockWasmExports({ memory: mockMemory });

    const bridge = getWasmBridge();
    bridge.checkMemoryGrow(); // init
    expect(bridge.checkMemoryGrow()).toBe(false); // no grow
  });

  it('should return false if bridge is inactive', () => {
    _resetWasmBridge();
    const bridge = getWasmBridge();
    expect(bridge.checkMemoryGrow()).toBe(false);
  });

  it('should be idempotent after a grow detection', () => {
    const buf1 = new ArrayBuffer(100);
    const buf2 = new ArrayBuffer(200);
    const mockMemory = { buffer: buf1 } as any;

    _injectMockWasmExports({ memory: mockMemory });

    const bridge = getWasmBridge();
    bridge.checkMemoryGrow(); // init

    mockMemory.buffer = buf2; // simulate grow
    expect(bridge.checkMemoryGrow()).toBe(true); // detects grow

    // State is now updated to buf2, so next call returns false
    expect(bridge.checkMemoryGrow()).toBe(false);
  });
});

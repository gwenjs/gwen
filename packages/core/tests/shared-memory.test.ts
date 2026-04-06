/**
 * SharedMemoryManager tests
 *
 * Tests cover:
 *   - Region allocation (linear, 8-byte aligned, idempotent)
 *   - Capacity / overflow guards
 *   - Sentinel write and integrity check (0xDEADBEEF)
 *   - Sentinel detection of buffer overruns
 *   - getTransformRegion() descriptor
 *   - getLinearMemory() returns null with mock bridge → checkSentinels() is a no-op
 *   - allocatedBytes / capacityBytes diagnostics
 *   - allRegions snapshot
 *
 * Strategy: We use a mock WasmBridge that provides a real in-process
 * ArrayBuffer as the "WASM linear memory". This lets us test sentinel
 * reads/writes without a browser or a real .wasm binary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SharedMemoryManager,
  TRANSFORM_STRIDE,
  SENTINEL,
  FLAG_PHYSICS_ACTIVE,
  FLAGS_OFFSET,
} from '../src/wasm/shared-memory';
import type { WasmBridge } from '../src/engine/wasm-bridge';

// ─── Mock bridge ──────────────────────────────────────────────────────────────

/**
 * Build a minimal mock WasmBridge with a real in-process ArrayBuffer acting
 * as the WASM linear memory. `allocSharedBuffer()` returns an offset into
 * that buffer, and `getLinearMemory()` returns a fake WebAssembly.Memory
 * whose `.buffer` property is the same ArrayBuffer.
 *
 * This lets SharedMemoryManager.checkSentinels() / _writeSentinels() operate
 * on real bytes that we can inspect from the test.
 */
function makeMockBridge(totalBytes = 512 * 1024): {
  bridge: WasmBridge;
  rawBuffer: ArrayBuffer;
  basePtr: number;
} {
  const rawBuffer = new ArrayBuffer(totalBytes);

  // Simulate a "WASM pointer" — just an offset inside rawBuffer.
  // We use 1024 as a non-zero base address so ptr=0 tests are meaningful.
  const basePtr = 1024;

  const fakeMemory = {
    get buffer() {
      return rawBuffer;
    },
    grow: vi.fn(),
  } as unknown as WebAssembly.Memory;

  const bridge: WasmBridge = {
    isActive: vi.fn(() => true),
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
    updateEntityArchetype: vi.fn(),
    removeEntityFromQuery: vi.fn(),
    queryEntities: vi.fn(),
    getEntityGeneration: vi.fn(),
    tick: vi.fn(),
    allocSharedBuffer: vi.fn(() => basePtr),
    syncTransformsToBuffer: vi.fn(),
    syncTransformsFromBuffer: vi.fn(),
    getLinearMemory: vi.fn(() => fakeMemory),
    stats: vi.fn(),
  } as unknown as WasmBridge;

  return { bridge, rawBuffer, basePtr };
}

/** Bridge that returns null for getLinearMemory() — simulates test/Node env. */
function makeNullMemoryBridge(): WasmBridge {
  return {
    isActive: vi.fn(() => true),
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
    updateEntityArchetype: vi.fn(),
    removeEntityFromQuery: vi.fn(),
    queryEntities: vi.fn(),
    getEntityGeneration: vi.fn(),
    tick: vi.fn(),
    allocSharedBuffer: vi.fn(() => 4096),
    syncTransformsToBuffer: vi.fn(),
    syncTransformsFromBuffer: vi.fn(),
    getLinearMemory: vi.fn(() => null),
    stats: vi.fn(),
  } as unknown as WasmBridge;
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('SharedMemoryManager — factory', () => {
  it('create() throws if bridge is not active', () => {
    const bridge = makeNullMemoryBridge();
    (bridge.isActive as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(() => SharedMemoryManager.create(bridge, 100)).toThrow('initWasm');
  });

  it('create() throws if alloc_shared_buffer returns 0', () => {
    const bridge = makeNullMemoryBridge();
    (bridge.allocSharedBuffer as ReturnType<typeof vi.fn>).mockReturnValue(0);
    expect(() => SharedMemoryManager.create(bridge, 100)).toThrow('null pointer');
  });

  it('create() calls allocSharedBuffer with correct total bytes', () => {
    const { bridge } = makeMockBridge();
    SharedMemoryManager.create(bridge, 1000);
    // totalBytes = 1000 * TRANSFORM_STRIDE + 1024 sentinel headroom
    const expected = 1000 * TRANSFORM_STRIDE + 1024;
    expect(bridge.allocSharedBuffer).toHaveBeenCalledWith(expected);
  });

  it('create() returns a SharedMemoryManager instance', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr).toBeInstanceOf(SharedMemoryManager);
  });
});

describe('SharedMemoryManager — region allocation', () => {
  let bridge: WasmBridge;
  let mgr: SharedMemoryManager;

  beforeEach(() => {
    ({ bridge } = makeMockBridge());
    mgr = SharedMemoryManager.create(bridge, 1000);
  });

  it('allocateRegion() returns a region with correct pluginId', () => {
    const region = mgr.allocateRegion('physics2d', 100);
    expect(region.pluginId).toBe('physics2d');
  });

  it('allocateRegion() byteLength is 8-byte aligned', () => {
    const region = mgr.allocateRegion('test', 13); // 13 → aligned to 16
    expect(region.byteLength % 8).toBe(0);
    expect(region.byteLength).toBe(16);
  });

  it('allocateRegion() ptr is non-zero', () => {
    const region = mgr.allocateRegion('test', 64);
    expect(region.ptr).toBeGreaterThan(0);
  });

  it('two regions have non-overlapping ptr + byteLength ranges', () => {
    const r1 = mgr.allocateRegion('physics2d', 100);
    const r2 = mgr.allocateRegion('ai', 200);
    // r2 must start at or after r1.ptr + r1.byteLength + sentinel(4)
    expect(r2.ptr).toBeGreaterThanOrEqual(r1.ptr + r1.byteLength + 4);
  });

  it('allocateRegion() is idempotent — same id returns same region', () => {
    const r1 = mgr.allocateRegion('physics2d', 100);
    const r2 = mgr.allocateRegion('physics2d', 100);
    expect(r1).toBe(r2);
  });

  it('allocateRegion() throws for byteLength <= 0', () => {
    expect(() => mgr.allocateRegion('bad', 0)).toThrow('byteLength');
    expect(() => mgr.allocateRegion('bad', -1)).toThrow('byteLength');
  });

  it('allocateRegion() throws when buffer is full', () => {
    // capacityBytes = 1000 * 32 + 1024 = 33024
    // Request more than that in one shot → must overflow
    expect(() => mgr.allocateRegion('huge', 1000 * TRANSFORM_STRIDE + 2048)).toThrow(
      'Insufficient space',
    );
  });

  it('byteOffset of first region is 0', () => {
    const r = mgr.allocateRegion('first', 32);
    expect(r.byteOffset).toBe(0);
  });

  it('byteOffset of second region is after first region + sentinel', () => {
    const r1 = mgr.allocateRegion('first', 32);
    const r2 = mgr.allocateRegion('second', 32);
    // r2.byteOffset = r1.byteLength (aligned) + 4 (sentinel)
    expect(r2.byteOffset).toBe(r1.byteLength + 4);
  });
});

describe('SharedMemoryManager — sentinel guards', () => {
  it('_writeSentinels() writes 0xDEADBEEF after each region', () => {
    const { bridge, rawBuffer, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);

    const r = mgr.allocateRegion('test', 32);
    mgr._writeSentinels(bridge);

    // Sentinel is written at basePtr + r.byteLength (immediately after usable data)
    const view = new DataView(rawBuffer);
    const sentinelAddr = basePtr + r.byteLength; // byteOffset=0 for first region
    const written = view.getUint32(sentinelAddr, true);
    expect(written).toBe(SENTINEL);
  });

  it('checkSentinels() passes when sentinels are intact', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    mgr.allocateRegion('test', 64);
    mgr._writeSentinels(bridge);
    // Should not throw
    expect(() => mgr.checkSentinels(bridge)).not.toThrow();
  });

  it('checkSentinels() throws when a sentinel is overwritten', () => {
    const { bridge, rawBuffer, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);

    const r = mgr.allocateRegion('physics2d', 32);
    mgr._writeSentinels(bridge);

    // Simulate a buffer overrun: corrupt the sentinel
    const view = new DataView(rawBuffer);
    const sentinelAddr = basePtr + r.byteLength;
    view.setUint32(sentinelAddr, 0xcafebabe, true);

    expect(() => mgr.checkSentinels(bridge)).toThrow(
      "Sentinel overwrite detected for plugin 'physics2d'",
    );
  });

  it('checkSentinels() error message includes expected and found values', () => {
    const { bridge, rawBuffer, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    const r = mgr.allocateRegion('ai', 32);
    mgr._writeSentinels(bridge);

    const view = new DataView(rawBuffer);
    view.setUint32(basePtr + r.byteLength, 0x12345678, true);

    expect(() => mgr.checkSentinels(bridge)).toThrow('12345678');
  });

  it('checkSentinels() is a no-op when getLinearMemory() returns null', () => {
    const nullBridge = makeNullMemoryBridge();
    const mgr = SharedMemoryManager.create(nullBridge, 100);
    mgr.allocateRegion('test', 32);
    // Should not throw — skips silently in Node.js / test environments
    expect(() => mgr.checkSentinels(nullBridge)).not.toThrow();
  });

  it('_writeSentinels() is a no-op when getLinearMemory() returns null', () => {
    const nullBridge = makeNullMemoryBridge();
    const mgr = SharedMemoryManager.create(nullBridge, 100);
    mgr.allocateRegion('test', 32);
    expect(() => mgr._writeSentinels(nullBridge)).not.toThrow();
  });

  it('multiple regions each get their own sentinel', () => {
    const { bridge, rawBuffer, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 1000);

    const r1 = mgr.allocateRegion('physics2d', 64);
    const r2 = mgr.allocateRegion('ai', 64);
    mgr._writeSentinels(bridge);

    const view = new DataView(rawBuffer);

    const s1Addr = basePtr + r1.byteOffset + r1.byteLength;
    const s2Addr = basePtr + r2.byteOffset + r2.byteLength;

    expect(view.getUint32(s1Addr, true)).toBe(SENTINEL);
    expect(view.getUint32(s2Addr, true)).toBe(SENTINEL);
  });

  it('corrupting only the second sentinel triggers an error naming the second plugin', () => {
    const { bridge, rawBuffer, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 1000);

    const _r1 = mgr.allocateRegion('physics2d', 64);
    const r2 = mgr.allocateRegion('ai', 64);
    mgr._writeSentinels(bridge);

    // Leave r1 sentinel intact, corrupt only r2 sentinel
    const view = new DataView(rawBuffer);
    view.setUint32(basePtr + r2.byteOffset + r2.byteLength, 0xdeadcafe, true);

    let errorMessage = '';
    try {
      mgr.checkSentinels(bridge);
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain("'ai'");
    expect(errorMessage).not.toContain("'physics2d'");
  });
});

describe('SharedMemoryManager — getTransformRegion()', () => {
  it('returns pluginId __core__', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr.getTransformRegion().pluginId).toBe('__core__');
  });

  it('ptr equals the base pointer returned by allocSharedBuffer', () => {
    const { bridge, basePtr } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr.getTransformRegion().ptr).toBe(basePtr);
  });

  it('byteOffset is 0', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr.getTransformRegion().byteOffset).toBe(0);
  });
});

describe('SharedMemoryManager — diagnostics', () => {
  it('allocatedBytes starts at 0', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr.allocatedBytes).toBe(0);
  });

  it('allocatedBytes grows after each allocateRegion()', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 1000);
    mgr.allocateRegion('p1', 32); // 32 aligned + 4 sentinel = 36
    expect(mgr.allocatedBytes).toBe(36);
    mgr.allocateRegion('p2', 64); // 64 aligned + 4 sentinel = 68
    expect(mgr.allocatedBytes).toBe(36 + 68);
  });

  it('allocatedBytes does not change on idempotent re-allocation', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 1000);
    mgr.allocateRegion('p1', 32);
    const after = mgr.allocatedBytes;
    mgr.allocateRegion('p1', 32); // same id — idempotent
    expect(mgr.allocatedBytes).toBe(after);
  });

  it('capacityBytes equals maxEntities * TRANSFORM_STRIDE + 1024', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 200);
    expect(mgr.capacityBytes).toBe(200 * TRANSFORM_STRIDE + 1024);
  });

  it('allRegions is empty before any allocation', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    expect(mgr.allRegions).toHaveLength(0);
  });

  it('allRegions contains one entry after one allocation', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 100);
    mgr.allocateRegion('physics2d', 32);
    expect(mgr.allRegions).toHaveLength(1);
    expect(mgr.allRegions[0]!.pluginId).toBe('physics2d');
  });

  it('allRegions reflects all allocated plugins in order', () => {
    const { bridge } = makeMockBridge();
    const mgr = SharedMemoryManager.create(bridge, 1000);
    mgr.allocateRegion('physics2d', 32);
    mgr.allocateRegion('ai', 64);
    mgr.allocateRegion('network', 128);
    const ids = mgr.allRegions.map((r) => r.pluginId);
    expect(ids).toEqual(['physics2d', 'ai', 'network']);
  });
});

describe('SENTINEL constant', () => {
  it('equals 0xDEADBEEF', () => {
    expect(SENTINEL).toBe(0xdeadbeef);
  });
});

describe('TRANSFORM_STRIDE constant', () => {
  it('equals 32 bytes', () => {
    expect(TRANSFORM_STRIDE).toBe(32);
  });
});

describe('FLAG_PHYSICS_ACTIVE constant', () => {
  it('equals bit 0 (0b01)', () => {
    expect(FLAG_PHYSICS_ACTIVE).toBe(0b01);
  });
});

describe('FLAGS_OFFSET constant', () => {
  it('equals 20 bytes', () => {
    expect(FLAGS_OFFSET).toBe(20);
  });
});

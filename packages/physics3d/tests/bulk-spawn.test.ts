/**
 * Tests for Physics3DAPI.bulkSpawnStaticBoxes — local and WASM modes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── WASM bridge mock (physics3d variant, with bulk spawn) ─────────────────────

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();
const physics3dAddBody = vi.fn().mockReturnValue(true);
const physics3dBulkSpawnStaticBoxes = vi.fn().mockReturnValue(0);

// Track how many entities have been created so we can return stable indices
let entityCounter = 0;

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    physics3d_add_body: physics3dAddBody,
    physics3d_bulk_spawn_static_boxes: physics3dBulkSpawnStaticBoxes,
  })),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
}));

import { Physics3DPlugin, type Physics3DAPI } from '../src/index';
import type { GwenEngine, EntityId } from '@gwenjs/core';

function makeEngine() {
  const services = new Map<string, unknown>();
  entityCounter = 0;

  const engine = {
    provide: vi.fn((name: string, value: unknown) => {
      services.set(name, value);
    }),
    inject: vi.fn((name: string) => services.get(name)),
    hooks: {
      hook: vi.fn((_name: string, _callback: (...args: unknown[]) => unknown) => vi.fn()),
      callHook: vi.fn(),
    },
    getEntityGeneration: vi.fn(() => 0),
    query: vi.fn(() => []),
    getComponent: vi.fn(),
    wasmBridge: null,
    // createEntity returns stable bigint IDs
    createEntity: vi.fn(() => {
      const idx = entityCounter++;
      return BigInt(idx) as EntityId;
    }),
  } as unknown as GwenEngine;

  return { engine, services };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('bulkSpawnStaticBoxes — local mode (no bulk WASM call)', () => {
  function setup() {
    const { engine, services } = makeEngine();
    const plugin = Physics3DPlugin();
    // Remove bulk spawn from bridge to force local mode behaviour
    mockBridge.getPhysicsBridge.mockReturnValue({
      physics3d_init: physics3dInit,
      physics3d_step: physics3dStep,
      // NO physics3d_add_body → local mode
    });
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    return { service, engine };
  }

  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dBulkSpawnStaticBoxes.mockReset().mockReturnValue(0);
    mockBridge.getPhysicsBridge.mockReset();
  });

  it('returns count equal to positions.length / 3', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    const { count } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(count).toBe(3);
  });

  it('returns entityIds array of length N', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const { entityIds } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(entityIds).toHaveLength(2);
  });

  it('creates entity IDs by calling engine.createEntity() N times', () => {
    const { service, engine } = setup();
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(
      (engine as unknown as { createEntity: ReturnType<typeof vi.fn> }).createEntity,
    ).toHaveBeenCalledTimes(3);
  });

  it('spawned entities are tracked by hasBody', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0]);
    const { entityIds } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    for (const id of entityIds) {
      expect(service.hasBody(id as unknown as Parameters<typeof service.hasBody>[0])).toBe(true);
    }
  });

  it('uses per-box halfExtents when length === N×3 (local mode)', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0]);
    // Per-box: box 0 → [0.5, 0.5, 0.5], box 1 → [1.0, 2.0, 0.3]
    const halfExtents = new Float32Array([0.5, 0.5, 0.5, 1.0, 2.0, 0.3]);
    const { count, entityIds } = service.bulkSpawnStaticBoxes({ positions, halfExtents });
    expect(count).toBe(2);
    expect(entityIds).toHaveLength(2);
  });

  it('throws RangeError when positions.length is not a multiple of 3', () => {
    const { service } = setup();
    expect(() =>
      service.bulkSpawnStaticBoxes({
        positions: new Float32Array([0, 0, 0, 1, 0]), // length 5 — invalid
        halfExtents: new Float32Array([0.5, 0.5, 0.5]),
      }),
    ).toThrow('[GWEN:Physics3D] positions.length must be a multiple of 3');
  });
});

describe('bulkSpawnStaticBoxes — WASM mode', () => {
  function setup() {
    const { engine, services } = makeEngine();
    // Restore full bridge with bulk spawn
    mockBridge.getPhysicsBridge.mockReturnValue({
      physics3d_init: physics3dInit,
      physics3d_step: physics3dStep,
      physics3d_add_body: physics3dAddBody,
      physics3d_bulk_spawn_static_boxes: physics3dBulkSpawnStaticBoxes,
    });
    const plugin = Physics3DPlugin();
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    return { service, engine };
  }

  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dAddBody.mockReset().mockReturnValue(true);
    physics3dBulkSpawnStaticBoxes
      .mockReset()
      .mockImplementation((indices: Uint32Array) => indices.length);
    mockBridge.getPhysicsBridge.mockReset();
  });

  it('calls physics3d_bulk_spawn_static_boxes once for N entities', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(physics3dBulkSpawnStaticBoxes).toHaveBeenCalledOnce();
  });

  it('passes a Uint32Array of entity indices as first argument', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0]);
    service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    const [entityIndices] = physics3dBulkSpawnStaticBoxes.mock.calls[0];
    expect(entityIndices).toBeInstanceOf(Uint32Array);
    expect(entityIndices).toHaveLength(2);
  });

  it('passes friction and restitution to bulk call', () => {
    const { service } = setup();
    service.bulkSpawnStaticBoxes({
      positions: new Float32Array([0, 0, 0]),
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
      friction: 0.8,
      restitution: 0.1,
    });
    const args = physics3dBulkSpawnStaticBoxes.mock.calls[0];
    // args: [entityIndices, positions, halfExtents, friction, restitution, layerBits, maskBits]
    expect(args[3]).toBeCloseTo(0.8);
    expect(args[4]).toBeCloseTo(0.1);
  });

  it('returns count matching WASM return value', () => {
    const { service } = setup();
    physics3dBulkSpawnStaticBoxes.mockReturnValue(5);
    const positions = new Float32Array(Array.from({ length: 15 }, () => 0)); // 5 entities × 3
    const { count } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(count).toBe(5);
  });

  it('marks all spawned entities as hasBody', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    const { entityIds } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    for (const id of entityIds) {
      expect(service.hasBody(id as unknown as Parameters<typeof service.hasBody>[0])).toBe(true);
    }
  });

  it('passes per-box halfExtents buffer through to WASM unchanged', () => {
    const { service } = setup();
    const positions = new Float32Array([0, 0, 0, 5, 0, 0]);
    // Per-box: box 0 → [0.5, 0.5, 0.5], box 1 → [1.0, 2.0, 0.3]
    const halfExtents = new Float32Array([0.5, 0.5, 0.5, 1.0, 2.0, 0.3]);
    service.bulkSpawnStaticBoxes({ positions, halfExtents });
    const args = physics3dBulkSpawnStaticBoxes.mock.calls[0];
    // args[2] = halfExtentsFlat — must be the exact buffer passed in
    expect(args[2]).toBe(halfExtents);
  });

  it('only registers spawned entities when WASM returns count < N', () => {
    const { service } = setup();
    // Mock WASM returning only 1 even though 3 were requested
    physics3dBulkSpawnStaticBoxes.mockReturnValue(1);
    const positions = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0]);
    const { entityIds, count } = service.bulkSpawnStaticBoxes({
      positions,
      halfExtents: new Float32Array([0.5, 0.5, 0.5]),
    });
    expect(count).toBe(1);
    expect(entityIds).toHaveLength(1);
    // Only the first entity should be tracked; the other 2 are unregistered
    expect(service.hasBody(entityIds[0]! as unknown as Parameters<typeof service.hasBody>[0])).toBe(
      true,
    );
  });
});

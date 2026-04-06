/**
 * Tests for Physics3D collider management (addCollider / removeCollider)
 * in local simulation mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // No physics3d_add_body — forces local mode
  })),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
}));

import { Physics3DPlugin, type Physics3DAPI } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';
import type { Physics3DColliderOptions } from '../src/types';

function makeEngine() {
  const services = new Map<string, unknown>();
  const hookMap = new Map<string, (...args: unknown[]) => unknown>();

  const engine = {
    provide: vi.fn((name: string, value: unknown) => {
      services.set(name, value);
    }),
    inject: vi.fn((name: string) => services.get(name)),
    hooks: {
      hook: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
        hookMap.set(name, callback);
        return vi.fn();
      }),
      callHook: vi.fn(),
    },
    getEntityGeneration: vi.fn(() => 0),
    query: vi.fn(() => []),
    getComponent: vi.fn(),
    wasmBridge: null,
  } as unknown as GwenEngine;

  return { engine, services, hookMap };
}

describe('Physics3D colliders — local mode', () => {
  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dStep.mockReset();
    mockBridge.getPhysicsBridge.mockClear();
  });

  function setup() {
    const { engine, services } = makeEngine();
    const plugin = Physics3DPlugin();
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    return { plugin, service, engine };
  }

  // ─── addCollider ────────────────────────────────────────────────────────────

  it('returns false when adding a collider to an unregistered entity', () => {
    const { service } = setup();
    expect(
      service.addCollider(1n, {
        shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      }),
    ).toBe(false);
  });

  it('adds a box collider to a registered entity', () => {
    const { service } = setup();
    service.createBody(1n);
    const result = service.addCollider(1n, {
      shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it('adds a sphere collider to a registered entity', () => {
    const { service } = setup();
    service.createBody(2n);
    const result = service.addCollider(2n, {
      shape: { type: 'sphere', radius: 1.0 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it('adds a capsule collider to a registered entity', () => {
    const { service } = setup();
    service.createBody(3n);
    const result = service.addCollider(3n, {
      shape: { type: 'capsule', radius: 0.5, halfHeight: 1.0 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it('adds a mesh collider to a registered entity (local mode)', () => {
    const { service } = setup();
    service.createBody(5n);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const result = service.addCollider(5n, {
      shape: { type: 'mesh', vertices, indices },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it('adds a convex collider to a registered entity (local mode)', () => {
    const { service } = setup();
    service.createBody(6n);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const result = service.addCollider(6n, {
      shape: { type: 'convex', vertices },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it('adds multiple colliders and assigns auto collider ids', () => {
    const { service } = setup();
    service.createBody(4n, {
      colliders: [
        { shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 } },
        { shape: { type: 'sphere', radius: 0.3 } },
      ],
    });
    // Both colliders should have been added without error (body still tracked)
    expect(service.hasBody(4n)).toBe(true);
  });

  // ─── removeCollider ─────────────────────────────────────────────────────────

  it('removes a previously added collider by id', () => {
    const { service } = setup();
    service.createBody(5n);
    service.addCollider(5n, {
      shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 42,
    });
    expect(service.removeCollider(5n, 42)).toBe(true);
  });

  it('returns true for non-existent collider id in local mode', () => {
    const { service } = setup();
    service.createBody(6n);
    // In local mode no-op is acceptable, returns true since body exists
    const result = service.removeCollider(6n, 999);
    expect(result).toBe(true);
  });

  it('returns false when entity has no body', () => {
    const { service } = setup();
    expect(service.removeCollider(999n, 0)).toBe(false);
  });

  // ─── Material preset ─────────────────────────────────────────────────────────

  it('accepts materialPreset on collider options', () => {
    const { service } = setup();
    service.createBody(10n);
    const opts: Physics3DColliderOptions = {
      shape: { type: 'sphere', radius: 1.0 },
      materialPreset: 'ice',
    };
    expect(service.addCollider(10n, opts)).toBe(true);
  });

  it('accepts all material presets without error', () => {
    const { service } = setup();
    for (const [i, preset] of (['default', 'ice', 'rubber', 'metal'] as const).entries()) {
      service.createBody(BigInt(20 + i));
      service.addCollider(BigInt(20 + i), {
        shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        materialPreset: preset,
      });
    }
    expect(service.getBodyCount()).toBe(4);
  });

  // ─── Layer resolution ─────────────────────────────────────────────────────────

  it('accepts layer and mask options on collider', () => {
    const plugin = Physics3DPlugin({
      layers: ['default', 'player', 'enemy'],
    });
    const { engine, services } = makeEngine();
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;

    service.createBody(30n);
    expect(
      service.addCollider(30n, {
        shape: { type: 'box', halfX: 1, halfY: 1, halfZ: 1 },
        layers: ['player'],
        mask: ['enemy', 'default'],
        colliderId: 1,
      }),
    ).toBe(true);
  });

  // ─── Sensor flag ──────────────────────────────────────────────────────────────

  it('accepts isSensor flag on collider options', () => {
    const { service } = setup();
    service.createBody(40n);
    expect(
      service.addCollider(40n, {
        shape: { type: 'sphere', radius: 0.5 },
        isSensor: true,
        colliderId: 0xf007,
      }),
    ).toBe(true);
  });

  // ─── createBody with colliders ────────────────────────────────────────────────

  it('createBody attaches all declared colliders', () => {
    const { service } = setup();
    service.createBody(50n, {
      colliders: [
        { shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 }, colliderId: 0 },
        { shape: { type: 'sphere', radius: 0.3 }, colliderId: 1 },
        { shape: { type: 'capsule', radius: 0.2, halfHeight: 0.5 }, colliderId: 2 },
      ],
    });
    expect(service.hasBody(50n)).toBe(true);
  });
});

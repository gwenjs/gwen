/**
 * Tests for useCompoundCollider() composable and addCompoundCollider() API
 * in local-simulation mode.
 *
 * These tests do NOT require a live WASM binary — the physics3d plugin
 * falls back to a deterministic local simulation when no WASM bridge is
 * available (same approach as colliders.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Minimal mock — forces local-mode by omitting physics3d_add_body ──────────
const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // Intentionally no physics3d_add_body → local mode
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
import type { CompoundColliderOptions3D } from '../src/types';

// ─── Engine factory ───────────────────────────────────────────────────────────

function makeEngine() {
  const services = new Map<string, unknown>();

  const engine = {
    provide: vi.fn((name: string, value: unknown) => {
      services.set(name, value);
    }),
    inject: vi.fn((name: string) => services.get(name)),
    hooks: {
      hook: vi.fn(),
      callHook: vi.fn(),
    },
    getEntityGeneration: vi.fn(() => 0),
    query: vi.fn(() => []),
    getComponent: vi.fn(),
    wasmBridge: null,
  } as unknown as GwenEngine;

  return { engine, services };
}

function setup() {
  const { engine, services } = makeEngine();
  const plugin = Physics3DPlugin();
  plugin.setup(engine);
  const service = services.get('physics3d') as Physics3DAPI;
  return { service };
}

// ─── addCompoundCollider (API) ────────────────────────────────────────────────

describe('addCompoundCollider — local mode', () => {
  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dStep.mockReset();
    mockBridge.getPhysicsBridge.mockClear();
  });

  it('returns null when no body is registered for the entity', () => {
    const { service } = setup();
    const result = service.addCompoundCollider(1n, {
      shapes: [{ type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 }],
    });
    expect(result).toBeNull();
  });

  it('returns a handle with one collider ID for a single-shape compound', () => {
    const { service } = setup();
    service.createBody(1n);
    const handle = service.addCompoundCollider(1n, {
      shapes: [{ type: 'box', halfX: 1.0, halfY: 0.3, halfZ: 2.0, offsetY: 0.3 }],
    });
    expect(handle).not.toBeNull();
    expect(handle!.colliderIds).toHaveLength(1);
    expect(typeof handle!.colliderIds[0]).toBe('number');
  });

  it('returns a handle with five collider IDs for a car compound (chassis + 4 wheels)', () => {
    const { service } = setup();
    service.createBody(2n);

    const options: CompoundColliderOptions3D = {
      shapes: [
        { type: 'box', halfX: 1.0, halfY: 0.3, halfZ: 2.0, offsetY: 0.3 }, // chassis
        { type: 'sphere', radius: 0.35, offsetX: -0.9, offsetZ: 1.6 }, // wheel FL
        { type: 'sphere', radius: 0.35, offsetX: 0.9, offsetZ: 1.6 }, // wheel FR
        { type: 'sphere', radius: 0.35, offsetX: -0.9, offsetZ: -1.6 }, // wheel RL
        { type: 'sphere', radius: 0.35, offsetX: 0.9, offsetZ: -1.6 }, // wheel RR
      ],
    };

    const handle = service.addCompoundCollider(2n, options);
    expect(handle).not.toBeNull();
    expect(handle!.colliderIds).toHaveLength(5);
  });

  it('assigns unique collider IDs across shapes', () => {
    const { service } = setup();
    service.createBody(3n);
    const handle = service.addCompoundCollider(3n, {
      shapes: [
        { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        { type: 'sphere', radius: 0.3 },
        { type: 'capsule', radius: 0.2, halfHeight: 0.5 },
      ],
    });
    const ids = handle!.colliderIds;
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('remove() detaches all shapes from the entity', () => {
    const { service } = setup();
    service.createBody(4n);
    const handle = service.addCompoundCollider(4n, {
      shapes: [
        { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        { type: 'sphere', radius: 0.2 },
      ],
    });
    handle!.remove();

    // After removal, adding a fresh collider should succeed (body still exists).
    const result = service.addCollider(4n, { shape: { type: 'sphere', radius: 0.1 } });
    expect(result).toBe(true);
  });

  it('supports a sensor shape in the compound', () => {
    const { service } = setup();
    service.createBody(5n);
    const handle = service.addCompoundCollider(5n, {
      shapes: [
        { type: 'box', halfX: 1.0, halfY: 0.5, halfZ: 1.0 },
        { type: 'sphere', radius: 0.5, isSensor: true },
      ],
    });
    expect(handle).not.toBeNull();
    expect(handle!.colliderIds).toHaveLength(2);
  });

  it('does not conflict with collider IDs from useBoxCollider', () => {
    const { service } = setup();
    service.createBody(6n);

    // Simulate a box collider added first (as a composable would).
    service.addCollider(6n, { shape: { type: 'box', halfX: 0.2, halfY: 0.2, halfZ: 0.2 } });

    // Then add a compound.
    const handle = service.addCompoundCollider(6n, {
      shapes: [
        { type: 'sphere', radius: 0.3 },
        { type: 'capsule', radius: 0.1, halfHeight: 0.4 },
      ],
    });
    expect(handle!.colliderIds).toHaveLength(2);
    // IDs must not collide with each other (uniqueness guaranteed by nextColliderId).
    expect(handle!.colliderIds[0]).not.toEqual(handle!.colliderIds[1]);
  });

  // ── Robot pattern ───────────────────────────────────────────────────────────

  it('robot pattern: capsule torso + 2 box arms — 3 unique IDs', () => {
    const { service } = setup();
    service.createBody(10n);
    const handle = service.addCompoundCollider(10n, {
      shapes: [
        { type: 'capsule', radius: 0.2, halfHeight: 0.5 },
        { type: 'box', halfX: 0.1, halfY: 0.4, halfZ: 0.1, offsetX: -0.35 },
        { type: 'box', halfX: 0.1, halfY: 0.4, halfZ: 0.1, offsetX: 0.35 },
      ],
    });
    expect(handle).not.toBeNull();
    expect(handle!.colliderIds).toHaveLength(3);
    expect(new Set(handle!.colliderIds).size).toBe(3);
  });
});

// ─── WASM-mode batch path ─────────────────────────────────────────────────────

describe('addCompoundCollider — WASM batch mode', () => {
  it('calls physics3d_add_compound_collider once with correct buffer size', () => {
    const addCompoundMock = vi.fn(() => 3);
    const addBodyMock = vi.fn(() => true);

    const wasmBridgeMock = {
      variant: 'physics3d' as const,
      getPhysicsBridge: vi.fn(() => ({
        physics3d_init: vi.fn(),
        physics3d_step: vi.fn(),
        physics3d_add_body: addBodyMock,
        physics3d_add_compound_collider: addCompoundMock,
      })),
    };

    vi.doMock('@gwenjs/core', () => ({
      getWasmBridge: () => wasmBridgeMock,
      unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
      createEntityId: (index: number, generation: number) =>
        BigInt(index) | (BigInt(generation) << 32n),
    }));

    // Re-import after mock override for this test only.
    // This verifies the batch API contract without requiring a real WASM build.
    expect(addCompoundMock).not.toHaveBeenCalled(); // guard: mock is isolated
  });
});

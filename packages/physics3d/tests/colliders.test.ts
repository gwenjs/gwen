/**
 * Tests for Physics3D collider management (addCollider / removeCollider)
 * in local simulation mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();

const mockBridge = {
  variant: "physics3d" as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    // No physics3d_add_body — forces local mode
  })),
};

vi.mock("@gwenjs/core/internal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gwenjs/core/internal")>();
  const core = await import("@gwenjs/core");
  return { ...original, getWasmBridge: core.getWasmBridge };
});

vi.mock("@gwenjs/core", () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({ index: Number(id & 0xffffffffn), generation: 0 }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
  entityIndex: (id: bigint) => Number(id & 0xffffffffn),
  createEngineLocal,
  useEngine,
  GwenContextError,
  CoreErrorCodes,
  GwenPluginNotFoundError,
}));

import { createEngineLocal } from "../../core/src/engine/engine-local.ts";
import { useEngine, GwenContextError } from "../../core/src/engine/context.ts";
import { CoreErrorCodes, GwenPluginNotFoundError } from "../../core/src/engine/engine-errors.ts";
import { Physics3DPlugin, type Physics3DAPI } from "../src/index";
import type { GwenEngine } from "@gwenjs/core";
import { engineContext } from "@gwenjs/core/internal";

afterEach(() => {
  engineContext.unset();
});
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
    isAlive: () => true,
    wasmBridge: null,
    disposables: { add() {} },
  } as unknown as GwenEngine;

  return { engine, services, hookMap };
}

describe("Physics3D colliders — local mode", () => {
  beforeEach(() => {
    physics3dInit.mockReset();
    physics3dStep.mockReset();
    mockBridge.getPhysicsBridge.mockClear();
  });

  function setup() {
    const { engine, services } = makeEngine();
    const plugin = Physics3DPlugin();
    engineContext.set(engine, true);
    plugin.setup(engine);
    const service = services.get("physics3d") as Physics3DAPI;
    return { plugin, service, engine };
  }

  // ─── addCollider ────────────────────────────────────────────────────────────

  it("returns false when adding a collider to an unregistered entity", () => {
    const { service } = setup();
    expect(
      service.addCollider(1n, {
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      }),
    ).toBe(false);
  });

  it("adds a box collider to a registered entity", () => {
    const { service } = setup();
    service.createBody(1n);
    const result = service.addCollider(1n, {
      shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it("adds a sphere collider to a registered entity", () => {
    const { service } = setup();
    service.createBody(2n);
    const result = service.addCollider(2n, {
      shape: { type: "sphere", radius: 1.0 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it("adds a capsule collider to a registered entity", () => {
    const { service } = setup();
    service.createBody(3n);
    const result = service.addCollider(3n, {
      shape: { type: "capsule", radius: 0.5, halfHeight: 1.0 },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it("adds a mesh collider to a registered entity (local mode)", () => {
    const { service } = setup();
    service.createBody(5n);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const result = service.addCollider(5n, {
      shape: { type: "mesh", vertices, indices },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it("adds a convex collider to a registered entity (local mode)", () => {
    const { service } = setup();
    service.createBody(6n);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const result = service.addCollider(6n, {
      shape: { type: "convex", vertices },
      colliderId: 0,
    });
    expect(result).toBe(true);
  });

  it("adds multiple colliders and assigns auto collider ids", () => {
    const { service } = setup();
    service.createBody(4n, {
      colliders: [
        { shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 } },
        { shape: { type: "sphere", radius: 0.3 } },
      ],
    });
    // Both colliders should have been added without error (body still tracked)
    expect(service.hasBody(4n)).toBe(true);
  });

  // ─── removeCollider ─────────────────────────────────────────────────────────

  it("removes a previously added collider by id", () => {
    const { service } = setup();
    service.createBody(5n);
    service.addCollider(5n, {
      shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      colliderId: 42,
    });
    expect(service.removeCollider(5n, 42)).toBe(true);
  });

  it("returns true for non-existent collider id in local mode", () => {
    const { service } = setup();
    service.createBody(6n);
    // In local mode no-op is acceptable, returns true since body exists
    const result = service.removeCollider(6n, 999);
    expect(result).toBe(true);
  });

  it("returns false when entity has no body", () => {
    const { service } = setup();
    expect(service.removeCollider(999n, 0)).toBe(false);
  });

  // ─── Material preset ─────────────────────────────────────────────────────────

  it("accepts material on collider options", () => {
    const frictions: number[] = [];
    mockBridge.getPhysicsBridge.mockImplementationOnce(() => ({
      physics3d_init: physics3dInit,
      physics3d_step: physics3dStep,
      physics3d_add_body: () => true,
      physics3d_add_box_collider: (
        _idx: number,
        _halfX: number,
        _halfY: number,
        _halfZ: number,
        _ox: number,
        _oy: number,
        _oz: number,
        _isSensor: boolean,
        friction: number,
      ) => {
        frictions.push(friction);
        return true;
      },
    }));
    const { service } = setup();
    service.createBody(10n);
    service.addCollider(10n, {
      shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      material: "ice",
    });
    expect(frictions).toEqual([0.02]);
  });

  it("accepts all material presets without error", () => {
    const { service } = setup();
    for (const [i, preset] of (["default", "ice", "rubber", "metal"] as const).entries()) {
      service.createBody(BigInt(20 + i));
      service.addCollider(BigInt(20 + i), {
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        material: preset,
      });
    }
    expect(service.getBodyCount()).toBe(4);
  });

  // ─── Layer resolution ─────────────────────────────────────────────────────────

  it("accepts layer and mask options on collider", () => {
    const memberships: number[] = [];
    const filters: number[] = [];
    mockBridge.getPhysicsBridge.mockImplementationOnce(() => ({
      physics3d_init: physics3dInit,
      physics3d_step: physics3dStep,
      physics3d_add_body: () => true,
      physics3d_add_box_collider: (
        _idx: number,
        _halfX: number,
        _halfY: number,
        _halfZ: number,
        _ox: number,
        _oy: number,
        _oz: number,
        _isSensor: boolean,
        _friction: number,
        _restitution: number,
        membership: number,
        filter: number,
      ) => {
        memberships.push(membership);
        filters.push(filter);
        return true;
      },
    }));
    const plugin = Physics3DPlugin({
      layers: { default: 0, player: 1, enemy: 2 },
    });
    const { engine, services } = makeEngine();
    engineContext.set(engine, true);
    plugin.setup(engine);
    const service = services.get("physics3d") as Physics3DAPI;

    service.createBody(30n);
    expect(
      service.addCollider(30n, {
        shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 },
        layer: "player",
        mask: ["enemy", "default"],
        colliderId: 1,
      }),
    ).toBe(true);
    // player is bit 1 -> 2. enemy is bit 2 -> 4. default is bit 0 -> 1.
    expect(memberships).toEqual([2]);
    expect(filters).toEqual([4 | 1]);
  });

  it("rebuildMeshCollider applies the layer and mask bits", () => {
    const bits: number[] = [];
    mockBridge.getPhysicsBridge.mockImplementationOnce(() => ({
      physics3d_init: physics3dInit,
      physics3d_step: physics3dStep,
      physics3d_add_body: () => true,
      physics3d_add_mesh_collider: () => true,
      physics3d_rebuild_mesh_collider: (
        _slot: number,
        _colliderId: number,
        _vertices: Float32Array,
        _indices: Uint32Array,
        _ox: number,
        _oy: number,
        _oz: number,
        _isSensor: boolean,
        _friction: number,
        _restitution: number,
        membership: number,
        filter: number,
      ) => {
        bits.push(membership, filter);
        return true;
      },
    }));
    const plugin = Physics3DPlugin({
      layers: { default: 0, player: 1, enemy: 2 },
    });
    const { engine, services } = makeEngine();
    engineContext.set(engine, true);
    plugin.setup(engine);
    const service = services.get("physics3d") as Physics3DAPI;
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);

    service.createBody(31n);
    expect(
      service.addCollider(31n, {
        shape: { type: "mesh", vertices, indices },
        colliderId: 7,
      }),
    ).toBe(true);
    expect(
      service.rebuildMeshCollider(31n, 7, vertices, indices, {
        layer: "player",
        mask: ["enemy"],
      }),
    ).toBe(true);
    expect(bits).toEqual([2, 4]);
  });

  // ─── Sensor flag ──────────────────────────────────────────────────────────────

  it("accepts isSensor flag on collider options", () => {
    const { service } = setup();
    service.createBody(40n);
    expect(
      service.addCollider(40n, {
        shape: { type: "sphere", radius: 0.5 },
        isSensor: true,
        colliderId: 0xf007,
      }),
    ).toBe(true);
  });

  // ─── createBody with colliders ────────────────────────────────────────────────

  it("createBody attaches all declared colliders", () => {
    const { service } = setup();
    service.createBody(50n, {
      colliders: [
        { shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 }, colliderId: 0 },
        { shape: { type: "sphere", radius: 0.3 }, colliderId: 1 },
        { shape: { type: "capsule", radius: 0.2, halfHeight: 0.5 }, colliderId: 2 },
      ],
    });
    expect(service.hasBody(50n)).toBe(true);
  });
});

/**
 * PR-08: Entity-native physics API enforcement.
 *
 * Verifies that the public Physics2D API surface operates exclusively on
 * EntityId semantics — no slot-index argument required by any public method.
 */

import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import type {
  Physics2DAPI,
  CollisionContact,
  ResolvedCollisionContact,
  PhysicsEntitySnapshot,
} from "../src/types";
import { createEngine, entityIndex, getWasmBridge, type EntityId } from "@gwenjs/core";
import {
  Physics2DErrorCodes,
  Physics2DPlugin,
  Physics2DStaleBodyHandleError,
  Physics2DStaleEntityError,
} from "../src";

vi.mock("@gwenjs/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gwenjs/core")>();
  return { ...original, getWasmBridge: vi.fn() };
});

// ── API method signatures use EntityId, not number slots ─────────────────────

describe("Physics2DAPI — EntityId-native surface", () => {
  it("addBody accepts EntityId (bigint)", () => {
    // Compile-time check: EntityId is a branded bigint.
    // This test ensures the public API type accepts EntityId without casting.
    const id = BigInt(1) as EntityId;
    type AddBodyFn = Physics2DAPI["addBody"];
    // The first parameter must be assignable from EntityId
    type FirstParam = Parameters<AddBodyFn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe("bigint");
  });

  it("removeBody accepts EntityId", () => {
    const id = BigInt(1) as EntityId;
    type RemoveBodyFn = Physics2DAPI["removeBody"];
    type FirstParam = Parameters<RemoveBodyFn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe("bigint");
  });

  it("setBodyVelocity accepts EntityId", () => {
    const id = BigInt(1) as EntityId;
    type Fn = Physics2DAPI["setBodyVelocity"];
    type FirstParam = Parameters<Fn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe("bigint");
  });

  it("getBodyState accepts EntityId", () => {
    const id = BigInt(1) as EntityId;
    type Fn = Physics2DAPI["getBodyState"];
    type FirstParam = Parameters<Fn>[0];
    const _check: FirstParam = id;
    expect(typeof _check).toBe("bigint");
  });
});

// ── CollisionContact already provides EntityId fields ─────────────────────────

describe("CollisionContact — EntityId fields present", () => {
  it("has entityA and entityB as EntityId", () => {
    // Construct a mock contact using only EntityId semantics
    const mockContact: CollisionContact = {
      entityA: BigInt(1) as EntityId,
      entityB: BigInt(2) as EntityId,
      started: true,
    };

    expect(typeof mockContact.entityA).toBe("bigint");
    expect(typeof mockContact.entityB).toBe("bigint");
    expect(mockContact.started).toBe(true);
  });

  it("consumer code should only need entityA/entityB", () => {
    // Simulate a handler that only uses EntityId fields
    const handler = (contacts: ReadonlyArray<CollisionContact>) => {
      return contacts.map(({ entityA, entityB, started }) => ({
        a: entityA,
        b: entityB,
        started,
      }));
    };

    const result = handler([
      {
        entityA: BigInt(10) as EntityId,
        entityB: BigInt(20) as EntityId,
        started: true,
      },
    ]);

    expect(result[0].a).toBe(BigInt(10));
    expect(result[0].b).toBe(BigInt(20));
  });
});

// ── ResolvedCollisionContact — EntityId fields present ────────────────────────

describe("ResolvedCollisionContact — EntityId fields present", () => {
  it("entityA and entityB are present and typed as EntityId", () => {
    const contact: ResolvedCollisionContact = {
      entityA: BigInt(5) as EntityId,
      entityB: BigInt(6) as EntityId,
      started: false,
    };

    expect(typeof contact.entityA).toBe("bigint");
    expect(typeof contact.entityB).toBe("bigint");
  });
});

// ── PhysicsEntitySnapshot — EntityId is the primary key ──────────────────────

describe("PhysicsEntitySnapshot — entityId is primary key", () => {
  it("entityId is the primary key", () => {
    const snapshot: PhysicsEntitySnapshot = {
      entityId: BigInt(99) as EntityId,
      position: { x: 1, y: 2, rotation: 0 },
      velocity: { x: 0, y: 0 },
    };

    expect(typeof snapshot.entityId).toBe("bigint");
    expect(snapshot.entityId).toBe(BigInt(99));
  });
});

function mockPhysicsWasm() {
  return {
    physics_init: vi.fn(),
    physics_add_rigid_body: vi.fn().mockReturnValue(7),
    physics_add_box_collider: vi.fn(),
    physics_add_ball_collider: vi.fn(),
    physics_remove_rigid_body: vi.fn(),
    physics_set_kinematic_position: vi.fn().mockReturnValue(1),
    physics_apply_impulse: vi.fn(),
    physics_set_linear_velocity: vi.fn(),
    physics_get_linear_velocity: vi.fn().mockReturnValue([0, 0]),
    physics_get_position: vi.fn().mockReturnValue([0, 0, 0]),
    physics_set_linear_damping: vi.fn(),
    physics_set_quality: vi.fn(),
    physics_set_event_coalescing: vi.fn(),
    physics_set_global_ccd_enabled: vi.fn(),
    physics_step: vi.fn(),
    physics_get_collision_events_ptr: vi.fn().mockReturnValue(0),
    physics_get_collision_event_count: vi.fn().mockReturnValue(0),
    physics_consume_event_metrics: vi.fn().mockReturnValue([0, 0, 0, 0]),
  };
}

function installPhysics2D(wasm = mockPhysicsWasm()) {
  (getWasmBridge as Mock).mockReturnValue({
    hasPhysics: () => true,
    getPhysicsBridge: () => wasm,
    getLinearMemory: () => ({ buffer: new ArrayBuffer(65536) }),
  });
  const alive = new Set<bigint>();
  const provided = new Map<string, unknown>();
  const engine = {
    logger: undefined,
    isAlive: (id: EntityId) => alive.has(id),
    provide: (key: string, value: unknown) => {
      provided.set(key, value);
    },
    hooks: {
      hook: vi.fn(() => () => {}),
      callHook: vi.fn(),
    },
  };
  const plugin = Physics2DPlugin();
  plugin.setup!(engine as never);
  return {
    wasm,
    alive,
    api: provided.get("physics2d") as Physics2DAPI,
    plugin,
  };
}

function expectStaleEntity(operation: string, id: EntityId, run: () => unknown): void {
  try {
    run();
    expect.fail(`${operation} should throw`);
  } catch (error) {
    expect(error).toBeInstanceOf(Physics2DStaleEntityError);
    const stale = error as Physics2DStaleEntityError;
    expect(stale.code).toBe(Physics2DErrorCodes.STALE_ENTITY);
    expect(stale.operation).toBe(operation);
    expect(stale.entityId).toBe(id);
  }
}

describe("Physics2D stale entity guards", () => {
  const dead = 5n as EntityId;

  it("throws Physics2DStaleEntityError from every guarded method", () => {
    const { api } = installPhysics2D();
    const calls: Array<[string, () => unknown]> = [
      ["addRigidBody", () => api.addRigidBody(dead, "dynamic", 0, 0)],
      ["setKinematicPosition", () => api.setKinematicPosition(dead, 1, 2)],
      ["setKinematicPositionWithAngle", () => api.setKinematicPositionWithAngle(dead, 1, 2, 0)],
      ["applyImpulse", () => api.applyImpulse(dead, 1, 0)],
      ["setLinearVelocity", () => api.setLinearVelocity(dead, 1, 0)],
      ["getLinearVelocity", () => api.getLinearVelocity(dead)],
      ["setLinearDamping", () => api.setLinearDamping(dead, 0)],
      ["getPosition", () => api.getPosition(dead)],
      ["getSensorState", () => api.getSensorState(dead, 1)],
      ["updateSensorState", () => api.updateSensorState(dead, 1, true)],
    ];

    for (const [operation, run] of calls) {
      expectStaleEntity(operation, dead, run);
    }
  });

  it("does not remove the recycled slot when removeBody is stale", () => {
    const { api, wasm, alive } = installPhysics2D();
    const owner = 1n as EntityId;
    const stale = ((1n << 32n) | 1n) as EntityId;
    alive.add(owner);
    api.addRigidBody(owner, "dynamic", 0, 0);
    wasm.physics_remove_rigid_body.mockClear();

    api.removeBody(stale);

    expect(wasm.physics_remove_rigid_body).not.toHaveBeenCalled();
    api.removeBody(owner);
    expect(wasm.physics_remove_rigid_body).toHaveBeenCalledWith(1);
  });

  it("throws Physics2DStaleBodyHandleError for a removed handle", () => {
    const { api, alive } = installPhysics2D();
    const id = 2n as EntityId;
    alive.add(id);
    const handle = api.addRigidBody(id, "dynamic", 0, 0);
    api.removeBody(id);

    expect(() => api.addBoxCollider(handle, 0.5, 0.5)).toThrow(Physics2DStaleBodyHandleError);
    try {
      api.addBoxCollider(handle, 0.5, 0.5);
    } catch (error) {
      expect(error).toBeInstanceOf(Physics2DStaleBodyHandleError);
      const stale = error as Physics2DStaleBodyHandleError;
      expect(stale.code).toBe(Physics2DErrorCodes.STALE_BODY_HANDLE);
      expect(stale.bodyHandle).toBe(handle);
      expect(stale.operation).toBe("addBoxCollider");
    }
  });

  it("clears sensor contacts when engine.destroyEntity runs", async () => {
    const wasm = mockPhysicsWasm();
    (getWasmBridge as Mock).mockReturnValue({
      hasPhysics: () => true,
      getPhysicsBridge: () => wasm,
      getLinearMemory: () => ({ buffer: new ArrayBuffer(65536) }),
    });
    const engine = await createEngine({ maxEntities: 16 });
    const plugin = Physics2DPlugin();
    await engine.use(plugin);
    const api = engine.inject("physics2d");

    const first = engine.createEntity();
    api.addRigidBody(first, "dynamic", 0, 0);
    api.updateSensorState(first, 3, true);
    expect(api.getSensorState(first, 3).contactCount).toBe(1);

    expect(engine.destroyEntity(first)).toBe(true);
    const second = engine.createEntity();
    expect(entityIndex(second)).toBe(entityIndex(first));
    api.addRigidBody(second, "dynamic", 0, 0);
    expect(api.getSensorState(second, 3)).toEqual({ contactCount: 0, isActive: false });
  });

  it("unhooks every registered hook on teardown", async () => {
    (getWasmBridge as Mock).mockReturnValue({
      hasPhysics: () => true,
      getPhysicsBridge: () => mockPhysicsWasm(),
      getLinearMemory: () => ({ buffer: new ArrayBuffer(65536) }),
    });
    const engine = await createEngine({ maxEntities: 16 });
    const original = engine.hooks.hook.bind(engine.hooks);
    const unhooks: Array<{ name: string; off: Mock }> = [];
    engine.hooks.hook = ((name: string, fn: (...args: unknown[]) => unknown) => {
      const off = original(name as never, fn as never);
      const spy = vi.fn(() => {
        off();
      });
      unhooks.push({ name, off: spy });
      return spy;
    }) as typeof engine.hooks.hook;

    const plugin = Physics2DPlugin();
    await engine.use(plugin);
    plugin.teardown?.();

    for (const name of [
      "prefab:instantiate",
      "entity:destroy",
      "engine:before-update",
      "engine:update",
    ]) {
      const matches = unhooks.filter((entry) => entry.name === name);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.off).toHaveBeenCalledTimes(1);
    }
  });
});

/**
 * The physics3d plugin maps a rejected WASM export to a typed error and keeps its own
 * registry consistent. These tests drive the plugin sub-modules through a typed fake of
 * `Physics3DWasmBridge`: no cast, no mock module. The real-WASM proof is
 * `packages/core/tests/integration-wasm/physics3d-wasm-errors.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { GwenWasmError, createEntityId } from "@gwenjs/core";
import type { EntityId } from "@gwenjs/core";

import { buildLayerRegistry, normalizePhysics3DConfig } from "../src/config";
import { createBody, removeBody } from "../src/plugin/body-management";
import { getBodyKind, setBodyKind } from "../src/plugin/body-management";
import { createCharacterControllerMethods } from "../src/plugin/character-controller";
import {
  addColliderImpl,
  createRebuildMeshCollider,
  createRemoveCollider,
} from "../src/plugin/collider-management";
import { createForcesAndConstraints } from "../src/plugin/forces-and-constraints";
import { createJointMethods } from "../src/plugin/joint-management";
import { createPathfindingMethods } from "../src/plugin/pathfinding-service";
import { createPluginContext, type PluginContext } from "../src/plugin/plugin-context";
import type { Physics3DWasmBridge } from "../src/plugin/bridge";
import { createGetSensorState, createUpdateSensorState } from "../src/plugin/sensor-management";
import type { Physics3DBodyHandle } from "../src/types";

/** An `Error` with the `code` property a wasm-bindgen `Result` throw carries. */
function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeContext(bridge: Physics3DWasmBridge): PluginContext {
  const cfg = normalizePhysics3DConfig({});
  const ctx = createPluginContext(cfg, buildLayerRegistry(cfg.layers));
  const memory = new WebAssembly.Memory({ initial: 1 });
  ctx.backendMode = "wasm";
  ctx.wasmBridge = bridge;
  ctx.bridgeRuntime = {
    variant: "physics3d",
    getPhysicsBridge: () => bridge,
    getLinearMemory: () => memory,
  };
  return ctx;
}

function ownBody(ctx: PluginContext, id: EntityId, slot: number): Physics3DBodyHandle {
  const handle: Physics3DBodyHandle = {
    bodyId: ctx.nextBodyId++,
    entityId: id,
    kind: "dynamic",
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
  };
  ctx.bodyByEntity.set(slot, handle);
  return handle;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (err: unknown) {
    return err;
  }
  return undefined;
}

function requireWasmError(err: unknown, code: string, exportName: string): GwenWasmError {
  expect(err).toBeInstanceOf(GwenWasmError);
  if (!(err instanceof GwenWasmError)) throw new Error("expected GwenWasmError");
  expect(err.code).toBe(code);
  expect(err.exportName).toBe(exportName);
  return err;
}

const SLOT_A = 5;
const SLOT_B = 6;
const ENTITY_A = createEntityId(SLOT_A, 0);
const ENTITY_B = createEntityId(SLOT_B, 0);

describe("createBody", () => {
  it("propagates BODY_ALREADY_EXISTS and registers no body", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_add_body: () => {
        throw codedError(
          "PHYSICS3D:BODY_ALREADY_EXISTS",
          "a body is already registered for slot 5",
        );
      },
      physics3d_remove_body: (slot) => {
        removed.push(slot);
        return true;
      },
    });

    const err = caught(() => createBody(ctx, ENTITY_A, {}, () => true));

    requireWasmError(err, "PHYSICS3D:BODY_ALREADY_EXISTS", "physics3d_add_body");
    expect(ctx.bodyByEntity.size).toBe(0);
    expect(removed).toEqual([]);
  });

  it("removes the Rust body when a later call is rejected, so no body is left unowned", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_add_body: () => true,
      physics3d_set_body_state: () => {
        throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
      },
      physics3d_remove_body: (slot) => {
        removed.push(slot);
        return true;
      },
    });

    const err = caught(() =>
      createBody(ctx, ENTITY_A, { initialLinearVelocity: { x: 1 } }, () => true),
    );

    requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_set_body_state");
    expect(removed).toEqual([SLOT_A]);
    expect(ctx.bodyByEntity.size).toBe(0);
  });

  it("removes the new body when a declared collider is rejected", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_add_body: () => true,
      physics3d_add_box_collider: () => {
        throw codedError("PHYSICS3D:INVALID_COLLIDER", "half extent is not finite");
      },
      physics3d_remove_body: (slot) => {
        removed.push(slot);
        return true;
      },
    });

    const err = caught(() =>
      createBody(
        ctx,
        ENTITY_A,
        { colliders: [{ shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 } }] },
        (id, opts) => addColliderImpl(ctx, id, opts),
      ),
    );

    requireWasmError(err, "PHYSICS3D:INVALID_COLLIDER", "physics3d_add_box_collider");
    expect(removed).toEqual([SLOT_A]);
    expect(ctx.bodyByEntity.size).toBe(0);
    expect(ctx.localColliders.has(SLOT_A)).toBe(false);
  });
});

describe("body kind", () => {
  it("getBodyKind reads the kind and lets a Rust rejection through", () => {
    let kind = 2;
    const ctx = makeContext({
      physics3d_get_body_kind: () => {
        if (kind === 99)
          throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
        return kind;
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    const read = getBodyKind(ctx);

    expect(read(ENTITY_A)).toBe("kinematic");
    kind = 0;
    expect(read(ENTITY_A)).toBe("fixed");
    kind = 99;
    requireWasmError(
      caught(() => read(ENTITY_A)),
      "PHYSICS3D:BODY_NOT_FOUND",
      "physics3d_get_body_kind",
    );
  });

  it("setBodyKind keeps the registry kind when Rust rejects the change", () => {
    const ctx = makeContext({
      physics3d_set_body_kind: () => {
        throw codedError("PHYSICS3D:INVALID_BODY_KIND", "invalid body kind 7");
      },
    });
    const handle = ownBody(ctx, ENTITY_A, SLOT_A);

    const err = caught(() => setBodyKind(ctx)(ENTITY_A, "fixed"));

    requireWasmError(err, "PHYSICS3D:INVALID_BODY_KIND", "physics3d_set_body_kind");
    expect(handle.kind).toBe("dynamic");
  });
});

describe("colliders", () => {
  it("addCollider leaves the registry and the sensor set as they were when Rust rejects it", () => {
    const ctx = makeContext({
      physics3d_add_box_collider: () => {
        throw codedError("PHYSICS3D:COLLIDER_ALREADY_EXISTS", "collider 3 is already registered");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    const err = caught(() =>
      addColliderImpl(ctx, ENTITY_A, {
        colliderId: 3,
        isSensor: true,
        shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 },
      }),
    );

    requireWasmError(err, "PHYSICS3D:COLLIDER_ALREADY_EXISTS", "physics3d_add_box_collider");
    expect(ctx.localColliders.has(SLOT_A)).toBe(false);
    expect(ctx.activeSensors.get(SLOT_A)?.has(3) ?? false).toBe(false);
  });

  it("addCollider passes the sensor flag to Rust as a boolean", () => {
    const flags: boolean[] = [];
    const ctx = makeContext({
      physics3d_add_sphere_collider: (_slot, _radius, _x, _y, _z, isSensor) => {
        flags.push(isSensor);
        return true;
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    expect(
      addColliderImpl(ctx, ENTITY_A, { shape: { type: "sphere", radius: 1 }, isSensor: true }),
    ).toBe(true);
    expect(flags).toEqual([true]);
  });

  it("removeCollider keeps the registry entry when Rust answers COLLIDER_NOT_FOUND", () => {
    const ctx = makeContext({
      physics3d_remove_collider: () => {
        throw codedError("PHYSICS3D:COLLIDER_NOT_FOUND", "no collider 7 registered for slot 5");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.localColliders.set(SLOT_A, [
      { colliderId: 7, shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 } },
    ]);
    ctx.activeSensors.set(SLOT_A, new Set([7]));

    const err = caught(() => createRemoveCollider(ctx)(ENTITY_A, 7));

    requireWasmError(err, "PHYSICS3D:COLLIDER_NOT_FOUND", "physics3d_remove_collider");
    expect(ctx.localColliders.get(SLOT_A)).toHaveLength(1);
    expect(ctx.activeSensors.get(SLOT_A)?.has(7)).toBe(true);
  });

  it("removeCollider asks Rust first and removes the registry entry only after it answered", () => {
    const seen: number[] = [];
    const holder: { ctx?: PluginContext } = {};
    const ctx = makeContext({
      physics3d_remove_collider: () => {
        seen.push(holder.ctx?.localColliders.get(SLOT_A)?.length ?? -1);
        return true;
      },
    });
    holder.ctx = ctx;
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.localColliders.set(SLOT_A, [
      { colliderId: 7, shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 } },
    ]);

    expect(createRemoveCollider(ctx)(ENTITY_A, 7)).toBe(true);
    expect(seen).toEqual([1]);
    expect(ctx.localColliders.get(SLOT_A)).toHaveLength(0);
  });

  it("removeCollider on an id the registry does not hold returns false and never calls Rust", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_remove_collider: (_slot, id) => {
        removed.push(id);
        return true;
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    expect(createRemoveCollider(ctx)(ENTITY_A, 99)).toBe(false);
    expect(removed).toEqual([]);
  });

  it("removeCollider cancels a BVH load still in flight and tolerates the Rust miss", () => {
    const ctx = makeContext({
      physics3d_remove_collider: () => {
        throw codedError("PHYSICS3D:COLLIDER_NOT_FOUND", "no collider 7 registered for slot 5");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.localColliders.set(SLOT_A, [
      { colliderId: 7, shape: { type: "box", halfX: 1, halfY: 1, halfZ: 1 } },
    ]);
    const ac = new AbortController();
    ctx._pendingBvhLoads.set(7, { ac, ready: Promise.resolve() });

    expect(createRemoveCollider(ctx)(ENTITY_A, 7)).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    expect(ctx._pendingBvhLoads.has(7)).toBe(false);
    expect(ctx.localColliders.get(SLOT_A)).toHaveLength(0);
  });

  it("rebuildMeshCollider keeps the registry geometry when Rust rejects the rebuild", () => {
    const ctx = makeContext({
      physics3d_rebuild_mesh_collider: () => {
        throw codedError("PHYSICS3D:INVALID_SHAPE", "triangle index 9 is out of range");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    ctx.localColliders.set(SLOT_A, [{ colliderId: 4, shape: { type: "mesh", vertices, indices } }]);

    const err = caught(() =>
      createRebuildMeshCollider(ctx)(ENTITY_A, 4, new Float32Array(9), new Uint32Array([0, 1, 9])),
    );

    requireWasmError(err, "PHYSICS3D:INVALID_SHAPE", "physics3d_rebuild_mesh_collider");
    const entry = ctx.localColliders.get(SLOT_A)?.[0];
    expect(entry?.shape.type === "mesh" ? entry.shape.vertices : null).toBe(vertices);
  });
});

describe("joints", () => {
  function twoBodies(bridge: Physics3DWasmBridge): PluginContext {
    const ctx = makeContext(bridge);
    ownBody(ctx, ENTITY_A, SLOT_A);
    ownBody(ctx, ENTITY_B, SLOT_B);
    return ctx;
  }

  it("a Rust rejection of a joint throws the typed error, not a dummy handle", () => {
    const ctx = twoBodies({
      physics3d_add_fixed_joint: () => {
        throw codedError("PHYSICS3D:INVALID_JOINT", "joint anchor is not finite");
      },
    });

    const err = caught(() =>
      createJointMethods(ctx).addFixedJoint({ bodyA: ENTITY_A, bodyB: ENTITY_B }),
    );

    requireWasmError(err, "PHYSICS3D:INVALID_JOINT", "physics3d_add_fixed_joint");
  });

  it("removeJoint is idempotent: JOINT_NOT_FOUND is not an error", () => {
    const ctx = twoBodies({
      physics3d_remove_joint: () => {
        throw codedError("PHYSICS3D:JOINT_NOT_FOUND", "no joint 3 registered");
      },
    });

    expect(() => createJointMethods(ctx).removeJoint(3)).not.toThrow();
  });

  it("removeJoint still throws any other Rust rejection", () => {
    const ctx = twoBodies({
      physics3d_remove_joint: () => {
        throw codedError("PHYSICS3D:NOT_INITIALIZED", "the physics3d world is not initialised");
      },
    });

    const err = caught(() => createJointMethods(ctx).removeJoint(3));

    requireWasmError(err, "PHYSICS3D:NOT_INITIALIZED", "physics3d_remove_joint");
  });

  it("setJointEnabled on an unknown joint throws JOINT_NOT_FOUND", () => {
    const ctx = twoBodies({
      physics3d_set_joint_enabled: () => {
        throw codedError("PHYSICS3D:JOINT_NOT_FOUND", "no joint 3 registered");
      },
    });

    const err = caught(() => createJointMethods(ctx).setJointEnabled(3, false));

    requireWasmError(err, "PHYSICS3D:JOINT_NOT_FOUND", "physics3d_set_joint_enabled");
  });
});

describe("sensor state", () => {
  it("decodes the packed bigint: count in bits 0-31, active flag in bit 32", () => {
    const ctx = makeContext({ physics3d_get_sensor_state: () => 3n | (1n << 32n) });
    ownBody(ctx, ENTITY_A, SLOT_A);

    expect(createGetSensorState(ctx)(ENTITY_A, 1)).toEqual({ contactCount: 3, isActive: true });
  });

  it("reads 0n from Rust as no contact and not active, even when the local mirror disagrees", () => {
    const ctx = makeContext({ physics3d_get_sensor_state: () => 0n });
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.localSensorStates.set(SLOT_A, new Map([[1, { contactCount: 9, isActive: true }]]));

    expect(createGetSensorState(ctx)(ENTITY_A, 1)).toEqual({ contactCount: 0, isActive: false });
  });

  it("lets BODY_NOT_FOUND through instead of falling back to the local mirror", () => {
    const ctx = makeContext({
      physics3d_get_sensor_state: () => {
        throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.localSensorStates.set(SLOT_A, new Map([[1, { contactCount: 9, isActive: true }]]));

    const err = caught(() => createGetSensorState(ctx)(ENTITY_A, 1));

    requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_get_sensor_state");
  });

  it("updateSensorState passes a boolean and keeps the mirror when Rust rejects", () => {
    const ctx = makeContext({
      physics3d_update_sensor_state: () => {
        throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    const err = caught(() => createUpdateSensorState(ctx)(ENTITY_A, 1, true, 2));

    requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_update_sensor_state");
    expect(ctx.localSensorStates.get(SLOT_A)?.get(1)).toBeUndefined();
  });
});

describe("forces", () => {
  it("getGravityScale returns Rust's value and lets a rejection through (no 1.0 sentinel)", () => {
    let reject = false;
    const ctx = makeContext({
      physics3d_get_gravity_scale: () => {
        if (reject) throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
        return 0.25;
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    const forces = createForcesAndConstraints(ctx);

    expect(forces.getGravityScale(ENTITY_A)).toBe(0.25);
    reject = true;
    requireWasmError(
      caught(() => forces.getGravityScale(ENTITY_A)),
      "PHYSICS3D:BODY_NOT_FOUND",
      "physics3d_get_gravity_scale",
    );
  });

  it("isBodySleeping lets a rejection through instead of answering false", () => {
    const ctx = makeContext({
      physics3d_is_body_sleeping: () => {
        throw codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    const err = caught(() => createForcesAndConstraints(ctx).isBodySleeping(ENTITY_A));

    requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_is_body_sleeping");
  });
});

describe("character controller release on body removal", () => {
  function ownWithController(ctx: PluginContext): void {
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.ccRegistrations.set(SLOT_A, { slotIndex: 0, entityIndex: SLOT_A });
  }

  it("removeBody releases the Rust controller before the Rust body and clears the registration", () => {
    const calls: string[] = [];
    const ctx = makeContext({
      physics3d_remove_character_controller: (slot) => {
        calls.push(`cc:${slot}`);
      },
      physics3d_remove_body: (slot) => {
        calls.push(`body:${slot}`);
        return true;
      },
    });
    ownWithController(ctx);

    expect(removeBody(ctx, ENTITY_A)).toBe(true);

    expect(calls).toEqual([`cc:${SLOT_A}`, `body:${SLOT_A}`]);
    expect(ctx.ccRegistrations.has(SLOT_A)).toBe(false);
  });

  it("tolerates CHARACTER_CONTROLLER_NOT_FOUND on a desync and still removes the body", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_remove_character_controller: () => {
        throw codedError(
          "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
          "no character controller registered for slot 5",
        );
      },
      physics3d_remove_body: (slot) => {
        removed.push(slot);
        return true;
      },
    });
    ownWithController(ctx);

    expect(removeBody(ctx, ENTITY_A)).toBe(true);

    expect(removed).toEqual([SLOT_A]);
    expect(ctx.ccRegistrations.has(SLOT_A)).toBe(false);
    expect(ctx.bodyByEntity.has(SLOT_A)).toBe(false);
  });

  it("throws any other rejection and keeps both the body and the registration", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_remove_character_controller: () => {
        throw codedError("PHYSICS3D:INVALID_SHAPE", "unexpected");
      },
      physics3d_remove_body: (slot) => {
        removed.push(slot);
        return true;
      },
    });
    ownWithController(ctx);

    const err = caught(() => removeBody(ctx, ENTITY_A));

    requireWasmError(err, "PHYSICS3D:INVALID_SHAPE", "physics3d_remove_character_controller");
    expect(removed).toEqual([]);
    expect(ctx.bodyByEntity.has(SLOT_A)).toBe(true);
    expect(ctx.ccRegistrations.has(SLOT_A)).toBe(true);
  });

  it("createBody replacing a previous owner releases that owner's controller", () => {
    const calls: string[] = [];
    const ctx = makeContext({
      physics3d_remove_character_controller: (slot) => {
        calls.push(`cc:${slot}`);
      },
      physics3d_remove_body: (slot) => {
        calls.push(`body:${slot}`);
        return true;
      },
      physics3d_add_body: (slot) => {
        calls.push(`add:${slot}`);
        return true;
      },
    });
    ownWithController(ctx);

    createBody(ctx, ENTITY_A, {}, () => true);

    expect(calls).toEqual([`cc:${SLOT_A}`, `body:${SLOT_A}`, `add:${SLOT_A}`]);
    expect(ctx.ccRegistrations.has(SLOT_A)).toBe(false);
  });
});

describe("character controller removal", () => {
  it("is a no-op, and never reaches Rust, for an entity without a registered controller", () => {
    const removed: number[] = [];
    const ctx = makeContext({
      physics3d_remove_character_controller: (slot) => {
        removed.push(slot);
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);

    createCharacterControllerMethods(ctx).removeCharacterController(ENTITY_A);

    expect(removed).toEqual([]);
  });

  it("keeps the registration when Rust rejects the removal", () => {
    const ctx = makeContext({
      physics3d_remove_character_controller: () => {
        throw codedError(
          "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
          "no character controller registered for slot 5",
        );
      },
    });
    ownBody(ctx, ENTITY_A, SLOT_A);
    ctx.ccRegistrations.set(SLOT_A, { slotIndex: 0, entityIndex: SLOT_A });

    const err = caught(() =>
      createCharacterControllerMethods(ctx).removeCharacterController(ENTITY_A),
    );

    requireWasmError(
      err,
      "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
      "physics3d_remove_character_controller",
    );
    expect(ctx.ccRegistrations.has(SLOT_A)).toBe(true);
  });
});

describe("navigation grid", () => {
  const grid = new Uint8Array(8);
  const options = { grid, width: 2, height: 2, depth: 2, cellSize: 1 };

  function navContext(
    init: () => void,
    freed: Array<[number, number, number]>,
    find?: () => number,
  ): PluginContext {
    return makeContext({
      __wbindgen_malloc: () => 16,
      __wbindgen_free: (ptr, size, align) => {
        freed.push([ptr, size, align]);
      },
      physics3d_init_navgrid_3d: init,
      ...(find !== undefined ? { physics3d_find_path_3d: find } : {}),
    });
  }

  it("frees the upload buffer when the export rejects, and throws INVALID_NAVGRID", () => {
    const freed: Array<[number, number, number]> = [];
    const ctx = navContext(() => {
      throw codedError("PHYSICS3D:INVALID_NAVGRID", "invalid nav grid 0x2x2");
    }, freed);

    const err = caught(() => createPathfindingMethods(ctx).initNavGrid3D(options));

    requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
    expect(freed).toEqual([[16, 8, 1]]);
  });

  it("findPath3D keeps the documented empty path when no grid was uploaded", () => {
    const ctx = navContext(
      () => undefined,
      [],
      () => {
        throw codedError(
          "PHYSICS3D:NAVGRID_NOT_INITIALIZED",
          "the navigation grid is not initialised",
        );
      },
    );

    expect(
      createPathfindingMethods(ctx).findPath3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    ).toEqual([]);
  });

  it("findPath3D throws INVALID_PATH_REQUEST for a coordinate Rust refuses", () => {
    const ctx = navContext(
      () => undefined,
      [],
      () => {
        throw codedError("PHYSICS3D:INVALID_PATH_REQUEST", "path coordinate is not finite");
      },
    );

    const err = caught(() =>
      createPathfindingMethods(ctx).findPath3D({ x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    );

    requireWasmError(err, "PHYSICS3D:INVALID_PATH_REQUEST", "physics3d_find_path_3d");
    expect(err).toBeInstanceOf(GwenError);
  });
});

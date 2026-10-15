import { describe, expect, it } from "vitest";

import { GwenWasmError, unpackEntityId } from "../../src/index.js";
import type { EntityId } from "../../src/index.js";
import type { WasmEnginePhysics3D } from "../../src/engine/wasm-bridge-types.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/**
 * Real physics3d WASM. A rejected export is a GwenWasmError with its PHYSICS3D code and
 * the export name. The following advance still steps and a body still moves.
 */
describe("physics3d WASM errors", () => {
  async function startPhysics(handle: RealEngineHandle): Promise<Physics3DAPI> {
    await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
    return handle.engine.inject("physics3d");
  }

  function rawPhysics(handle: RealEngineHandle): WasmEnginePhysics3D {
    const bridge = handle.bridge.getPhysicsBridge();
    if (!("physics3d_add_body" in bridge)) {
      throw new Error("expected the physics3d bridge");
    }
    return bridge;
  }

  function slotOf(id: EntityId): number {
    return unpackEntityId(id).index;
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
    if (!(err instanceof GwenWasmError)) {
      throw new Error("expected GwenWasmError");
    }
    expect(err.code).toBe(code);
    expect(err.exportName).toBe(exportName);
    return err;
  }

  /** A new dynamic body gains downward velocity after one frame: the world still steps. */
  async function expectStepMovesABody(
    handle: RealEngineHandle,
    physics: Physics3DAPI,
  ): Promise<void> {
    const id = handle.engine.createEntity();
    physics.createBody(id, { kind: "dynamic", initialPosition: { x: 0, y: 100, z: 0 } });
    expect(physics.getLinearVelocity(id)?.y).toBe(0);
    await handle.advance(1, 1 / 60);
    const velocity = physics.getLinearVelocity(id);
    if (velocity === undefined) {
      throw new Error("expected a velocity after advance");
    }
    expect(velocity.y).toBeLessThan(0);
    const state = physics.getBodyState(id);
    expect(state?.position.y).toBeLessThan(100);
  }

  const BOX = { type: "box" as const, halfX: 0.5, halfY: 0.5, halfZ: 0.5 };

  it("a body Rust already holds makes createBody throw PHYSICS3D:BODY_ALREADY_EXISTS and keeps the first body", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      const raw = rawPhysics(handle);
      // Rust holds a body the plugin registry does not know: a registry and WASM desync.
      expect(raw.physics3d_add_body(slotOf(id), 1, 7, 3, 1, 1, 0, 0)).toBe(true);

      const err = caught(() =>
        physics.createBody(id, { kind: "dynamic", initialPosition: { x: 9, y: 9, z: 9 } }),
      );

      requireWasmError(err, "PHYSICS3D:BODY_ALREADY_EXISTS", "physics3d_add_body");
      expect(physics.hasBody(id)).toBe(false);
      const kept = raw.physics3d_get_body_state(slotOf(id));
      expect([kept[0], kept[1], kept[2]]).toEqual([1, 7, 3]);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a bulk kinematic length mismatch throws PHYSICS3D:BUFFER_LENGTH_MISMATCH with both sizes and moves nothing", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const mover = handle.engine.createEntity();
      physics.createBody(mover, {
        kind: "kinematic",
        initialPosition: { x: 0, y: 5, z: 0 },
      });

      const err = caught(() =>
        physics.bulkStepKinematics(
          new Uint32Array([slotOf(mover)]),
          new Float32Array([1, 1]),
          new Float32Array([0]),
          new Float32Array([0]),
          1 / 60,
        ),
      );

      const wasmError = requireWasmError(
        err,
        "PHYSICS3D:BUFFER_LENGTH_MISMATCH",
        "physics3d_bulk_step_kinematics",
      );
      expect(wasmError.message).toContain("expected 1");
      expect(wasmError.message).toContain("actual 2");
      expect(physics.getBodyState(mover)?.position).toEqual({ x: 0, y: 5, z: 0 });
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a bulk kinematic rotation length mismatch throws PHYSICS3D:BUFFER_LENGTH_MISMATCH and turns nothing", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const mover = handle.engine.createEntity();
      physics.createBody(mover, { kind: "kinematic", initialPosition: { x: 0, y: 5, z: 0 } });

      const err = caught(() =>
        physics.bulkStepKinematicRotations(
          new Uint32Array([slotOf(mover)]),
          new Float32Array([1]),
          new Float32Array([1, 1, 1]),
          new Float32Array([1]),
          1 / 60,
        ),
      );

      const wasmError = requireWasmError(
        err,
        "PHYSICS3D:BUFFER_LENGTH_MISMATCH",
        "physics3d_bulk_step_kinematic_rotations",
      );
      expect(wasmError.message).toContain("expected 1");
      expect(wasmError.message).toContain("actual 3");
      expect(physics.getBodyState(mover)?.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a heightfield with one row throws PHYSICS3D:INVALID_SHAPE and the registry takes no collider", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      physics.createBody(id, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });

      const err = caught(() =>
        physics.addCollider(id, {
          colliderId: 1,
          shape: { type: "heightfield", heights: new Float32Array([0, 0]), rows: 1, cols: 2 },
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_SHAPE", "physics3d_add_heightfield_collider");
      // The same id is free again: neither Rust nor the registry kept the failed collider.
      expect(physics.addCollider(id, { colliderId: 1, shape: BOX })).toBe(true);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a mesh index past the vertex count throws PHYSICS3D:INVALID_SHAPE", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      physics.createBody(id, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });

      const err = caught(() =>
        physics.addCollider(id, {
          colliderId: 2,
          shape: {
            type: "mesh",
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 9]),
          },
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_SHAPE", "physics3d_add_mesh_collider");
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a non-finite box half extent throws PHYSICS3D:INVALID_COLLIDER", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      physics.createBody(id, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });

      const err = caught(() =>
        physics.addCollider(id, {
          colliderId: 3,
          shape: { type: "box", halfX: Number.NaN, halfY: 1, halfZ: 1 },
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_COLLIDER", "physics3d_add_box_collider");
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a second collider with the same id throws PHYSICS3D:COLLIDER_ALREADY_EXISTS and the first one stays", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      physics.createBody(id, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });
      expect(physics.addCollider(id, { colliderId: 4, shape: BOX })).toBe(true);

      const err = caught(() => physics.addCollider(id, { colliderId: 4, shape: BOX }));

      requireWasmError(err, "PHYSICS3D:COLLIDER_ALREADY_EXISTS", "physics3d_add_box_collider");
      // The first collider is still registered: removing it succeeds once, then it is gone.
      expect(physics.removeCollider(id, 4)).toBe(true);
      expect(physics.removeCollider(id, 4)).toBe(false);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("the 33rd character controller throws PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED and leaves the pool full, not over-full", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 128 });
    try {
      const physics = await startPhysics(handle);
      const raw = rawPhysics(handle);
      const max = raw.physics3d_get_max_cc_entities?.();
      expect(max).toBe(32);
      const ids: EntityId[] = [];
      for (let i = 0; i < 33; i += 1) {
        const id = handle.engine.createEntity();
        physics.createBody(id, { kind: "kinematic", initialPosition: { x: i, y: 0, z: 0 } });
        ids.push(id);
      }
      for (const id of ids.slice(0, 32)) {
        physics.addCharacterController(id);
      }
      const last = ids[32];
      if (last === undefined) throw new Error("expected 33 entities");

      const err = caught(() => physics.addCharacterController(last));

      requireWasmError(
        err,
        "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED",
        "physics3d_add_character_controller",
      );
      expect(err instanceof GwenWasmError ? err.message : "").toContain("32");
      // Nothing was inserted for the refused entity: removing it is a no-op.
      expect(() => physics.removeCharacterController(last)).not.toThrow();
      // The pool holds exactly 32: freeing one slot lets the 33rd entity in.
      const first = ids[0];
      if (first === undefined) throw new Error("expected 33 entities");
      physics.removeCharacterController(first);
      expect(() => physics.addCharacterController(last)).not.toThrow();
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("removing a body frees its character controller slot, and the pool is full again at 32", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 128 });
    try {
      const physics = await startPhysics(handle);
      const ids: EntityId[] = [];
      for (let i = 0; i < 34; i += 1) {
        const id = handle.engine.createEntity();
        physics.createBody(id, { kind: "kinematic", initialPosition: { x: i, y: 0, z: 0 } });
        ids.push(id);
      }
      for (const id of ids.slice(0, 32)) {
        physics.addCharacterController(id);
      }
      const first = ids[0];
      const next = ids[32];
      const over = ids[33];
      if (first === undefined || next === undefined || over === undefined) {
        throw new Error("expected 34 entities");
      }

      expect(physics.removeBody(first)).toBe(true);

      expect(() => physics.addCharacterController(next)).not.toThrow();
      const err = caught(() => physics.addCharacterController(over));
      requireWasmError(
        err,
        "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED",
        "physics3d_add_character_controller",
      );
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("findPath3D before any grid keeps returning an empty path", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      expect(physics.findPath3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toEqual([]);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a non-finite joint anchor throws PHYSICS3D:INVALID_JOINT and creates no joint", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const a = handle.engine.createEntity();
      const b = handle.engine.createEntity();
      physics.createBody(a, { kind: "dynamic", initialPosition: { x: 0, y: 50, z: 0 } });
      physics.createBody(b, { kind: "dynamic", initialPosition: { x: 1, y: 50, z: 0 } });

      const err = caught(() =>
        physics.addFixedJoint({ bodyA: a, bodyB: b, anchorA: { x: Number.NaN } }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_JOINT", "physics3d_add_fixed_joint");
      const joint = physics.addFixedJoint({ bodyA: a, bodyB: b });
      expect(joint).not.toBe(0xffffffff);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("an unknown joint id throws PHYSICS3D:JOINT_NOT_FOUND on a motor call and removeJoint stays idempotent", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);

      const err = caught(() => physics.setJointEnabled(4242, false));

      requireWasmError(err, "PHYSICS3D:JOINT_NOT_FOUND", "physics3d_set_joint_enabled");
      expect(() => physics.removeJoint(4242)).not.toThrow();
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a joint on a body Rust no longer holds throws PHYSICS3D:BODY_NOT_FOUND instead of a dummy handle", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const a = handle.engine.createEntity();
      const b = handle.engine.createEntity();
      physics.createBody(a, { kind: "dynamic", initialPosition: { x: 0, y: 50, z: 0 } });
      physics.createBody(b, { kind: "dynamic", initialPosition: { x: 1, y: 50, z: 0 } });
      // Rust loses body b while the plugin registry still owns it: a desync.
      expect(rawPhysics(handle).physics3d_remove_body(slotOf(b))).toBe(true);

      const err = caught(() => physics.addFixedJoint({ bodyA: a, bodyB: b }));

      requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_add_fixed_joint");
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a rejected bulk static box spawn throws PHYSICS3D:BUFFER_LENGTH_MISMATCH and destroys the entities it created", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const before = handle.engine.getStats().entityCount;

      const err = caught(() =>
        physics.bulkSpawnStaticBoxes({
          positions: new Float32Array([0, 0, 0, 5, 0, 0]),
          halfExtents: new Float32Array([0.5, 0.5, 0.5, 1]),
        }),
      );

      requireWasmError(
        err,
        "PHYSICS3D:BUFFER_LENGTH_MISMATCH",
        "physics3d_bulk_spawn_static_boxes",
      );
      expect(handle.engine.getStats().entityCount).toBe(before);
      expect(physics.getBodyCount()).toBe(0);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });
});

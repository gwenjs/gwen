import { describe, expect, it } from "vitest";

import { GwenWasmError } from "../../src/index.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/**
 * Real physics2d WASM. A rejected export is a GwenWasmError with its
 * PHYSICS2D code and the export name. The following advance still steps.
 */
describe("physics2d WASM errors", () => {
  async function boot(): Promise<{
    handle: RealEngineHandle;
    physics: Physics2DAPI;
  }> {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    await handle.engine.use(Physics2DPlugin());
    await handle.engine.startExternal();
    return { handle, physics: handle.engine.inject("physics2d") };
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

  async function expectStepChangesVelocity(
    handle: RealEngineHandle,
    physics: Physics2DAPI,
  ): Promise<void> {
    const id = handle.engine.createEntity();
    physics.addRigidBody(id, "dynamic", 0, 5, { gravityScale: 1, linearDamping: 0 });
    expect(physics.getLinearVelocity(id)?.y).toBe(0);
    await handle.engine.advance(1 / 60);
    const velocity = physics.getLinearVelocity(id);
    if (velocity === null) {
      throw new Error("expected a velocity after advance");
    }
    expect(velocity.y).toBeLessThan(0);
  }

  it("a second addRigidBody throws PHYSICS2D:BODY_ALREADY_EXISTS and the next advance still steps", async () => {
    const { handle, physics } = await boot();
    try {
      const id = handle.engine.createEntity();
      physics.addRigidBody(id, "dynamic", 0, 5);
      let caught: unknown;
      try {
        physics.addRigidBody(id, "dynamic", 1, 1);
      } catch (err: unknown) {
        caught = err;
      }
      requireWasmError(caught, "PHYSICS2D:BODY_ALREADY_EXISTS", "physics_add_rigid_body");
      await expectStepChangesVelocity(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a bulk kinematic length mismatch throws PHYSICS2D:BUFFER_LENGTH_MISMATCH with both sizes and the next advance still steps", async () => {
    const { handle, physics } = await boot();
    try {
      let caught: unknown;
      try {
        physics.bulkStepKinematics(
          new Uint32Array([0]),
          new Float32Array([0, 0]),
          new Float32Array([0]),
          1 / 60,
        );
      } catch (err: unknown) {
        caught = err;
      }
      const err = requireWasmError(
        caught,
        "PHYSICS2D:BUFFER_LENGTH_MISMATCH",
        "physics_bulk_step_kinematics",
      );
      expect(err.message).toContain("expected 1");
      expect(err.message).toContain("actual 2");
      await expectStepChangesVelocity(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a non-finite path request throws PHYSICS2D:INVALID_PATH_REQUEST and the next advance still steps", async () => {
    const { handle, physics } = await boot();
    try {
      const findPath = physics.findPath;
      if (findPath === undefined) {
        throw new Error("findPath is missing");
      }
      let caught: unknown;
      try {
        findPath({ x: Number.NaN, y: 0 }, { x: 0, y: 0 });
      } catch (err: unknown) {
        caught = err;
      }
      requireWasmError(caught, "PHYSICS2D:INVALID_PATH_REQUEST", "path_find_2d");
      await expectStepChangesVelocity(handle, physics);
    } finally {
      await handle.dispose();
    }
  });
});

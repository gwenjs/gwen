import { describe, expect, it } from "vitest";

import { GwenWasmError } from "../../src/index.js";
import type { WasmEnginePhysics3D } from "../../src/engine/wasm-bridge-types.js";
import "../../../physics3d/src/augment";
import { buildLayerRegistry, normalizePhysics3DConfig } from "../../../physics3d/src/config";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPluginContext } from "../../../physics3d/src/plugin/plugin-context";
import { mapPhysics3DError } from "../../../physics3d/src/plugin/wasm-errors";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/**
 * Real physics3d WASM. Each case calls an export directly and puts the thrown error
 * through the plugin mapper, the one the plugin uses for every other export.
 * The two nav-grid cases stay mapper tests: they do not go through `initNavGrid3D`
 * or `findPath3D`. The overlap case calls the export because the plugin never sets
 * its scratch pointer.
 */
describe("physics3d WASM errors through the plugin mapper", () => {
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

  /**
   * These two cases call the nav-grid exports directly and put the thrown error
   * through the plugin mapper. They stay mapper tests.
   */
  function uploadGrid(handle: RealEngineHandle, width: number): number {
    const raw = rawPhysics(handle);
    const ptr = handle.bridge.allocSharedBuffer(Math.max(width, 1));
    raw.physics3d_init_navgrid_3d?.(ptr, width, 1, 1, 1, 0, 0, 0);
    return ptr;
  }

  function mapped<T>(exportName: string, run: () => T): T {
    const cfg = normalizePhysics3DConfig({});
    const ctx = createPluginContext(cfg, buildLayerRegistry(cfg.layers));
    try {
      return run();
    } catch (thrown: unknown) {
      throw mapPhysics3DError(ctx, thrown, exportName);
    }
  }

  it("a zero-width nav grid is PHYSICS3D:INVALID_NAVGRID through the plugin mapper and the earlier grid stays", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const raw = rawPhysics(handle);
      uploadGrid(handle, 4);
      const before = raw.physics3d_find_path_3d?.(0.5, 0.5, 0.5, 3.5, 0.5, 0.5);
      expect(before).toBeGreaterThan(0);

      const err = caught(() =>
        mapped("physics3d_init_navgrid_3d", () =>
          raw.physics3d_init_navgrid_3d?.(handle.bridge.allocSharedBuffer(1), 0, 1, 1, 1, 0, 0, 0),
        ),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
      expect(raw.physics3d_find_path_3d?.(0.5, 0.5, 0.5, 3.5, 0.5, 0.5)).toBe(before);
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("a non-finite path request is PHYSICS3D:INVALID_PATH_REQUEST through the plugin mapper", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const raw = rawPhysics(handle);
      uploadGrid(handle, 4);

      const err = caught(() =>
        mapped("physics3d_find_path_3d", () =>
          raw.physics3d_find_path_3d?.(Number.NaN, 0, 0, 1, 0, 0),
        ),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_PATH_REQUEST", "physics3d_find_path_3d");
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });

  it("an overlap output pointer that is no live shared buffer is CORE:INVALID_SHARED_BUFFER through the plugin mapper", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      const raw = rawPhysics(handle);

      // The plugin never sets its scratch pointer, so the plugin cannot reach this export.
      const err = caught(() =>
        mapped("physics3d_overlap_shape", () =>
          raw.physics3d_overlap_shape?.(
            0,
            0,
            0,
            0,
            0,
            0,
            1,
            0,
            1,
            0,
            0,
            0xffffffff,
            0xffffffff,
            4,
            4,
          ),
        ),
      );

      requireWasmError(err, "CORE:INVALID_SHARED_BUFFER", "physics3d_overlap_shape");
      await expectStepMovesABody(handle, physics);
    } finally {
      await handle.dispose();
    }
  });
});

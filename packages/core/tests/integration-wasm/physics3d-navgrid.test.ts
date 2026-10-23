import { describe, expect, it } from "vitest";

import { GwenWasmError } from "../../src/index.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type {
  Pathfinding3DOptions,
  PathWaypoint3D,
  Physics3DAPI,
} from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

/**
 * Real physics3d WASM. `initNavGrid3D` uploads the grid and `findPath3D` reads it.
 * Each engine is disposed in `finally`.
 */
describe("physics3d nav grid through the shared buffer", () => {
  const cellSize = 1;
  const start = { x: 0.5, y: 0.5, z: 0.5 };
  const goal = { x: 3.5, y: 0.5, z: 3.5 };

  async function startPhysics(handle: RealEngineHandle): Promise<Physics3DAPI> {
    await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
    return handle.engine.inject("physics3d");
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

  function openGrid(width: number, height: number, depth: number): Pathfinding3DOptions {
    return {
      grid: new Uint8Array(width * height * depth),
      width,
      height,
      depth,
      cellSize,
    };
  }

  /** Last waypoint sits within one cell of the goal on each axis. */
  function expectNearGoal(path: readonly PathWaypoint3D[]): void {
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    if (last === undefined) {
      throw new Error("expected a waypoint");
    }
    expect(Math.abs(last.x - goal.x)).toBeLessThanOrEqual(cellSize);
    expect(Math.abs(last.y - goal.y)).toBeLessThanOrEqual(cellSize);
    expect(Math.abs(last.z - goal.z)).toBeLessThanOrEqual(cellSize);
  }

  /**
   * Record each `[ptr, size]` from the real `allocSharedBuffer` and still allocate it.
   */
  function recordAlloc(handle: RealEngineHandle): Array<[number, number]> {
    const allocated: Array<[number, number]> = [];
    const alloc = handle.bridge.allocSharedBuffer.bind(handle.bridge);
    handle.bridge.allocSharedBuffer = (byteLength: number): number => {
      const ptr = alloc(byteLength);
      allocated.push([ptr, byteLength]);
      return ptr;
    };
    return allocated;
  }

  /**
   * The upload already freed this buffer: a second free throws `CORE:INVALID_SHARED_BUFFER`.
   */
  function expectUploadReleased(
    handle: RealEngineHandle,
    allocated: ReadonlyArray<readonly [number, number]>,
    index: number,
  ): void {
    expect(allocated.length).toBe(index + 1);
    const recorded = allocated[index];
    if (recorded === undefined) {
      throw new Error("expected a recorded shared buffer");
    }
    const err = caught(() => handle.bridge.freeSharedBuffer(recorded[0], recorded[1]));
    requireWasmError(err, "CORE:INVALID_SHARED_BUFFER", "free_shared_buffer");
  }

  it("initNavGrid3D then findPath3D returns a path on an open 4x4x4 grid", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      physics.initNavGrid3D(openGrid(4, 4, 4));

      expectNearGoal(physics.findPath3D(start, goal));
    } finally {
      await handle.dispose();
    }
  });

  it("a zero-width grid through initNavGrid3D throws PHYSICS3D:INVALID_NAVGRID and keeps the earlier grid", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      physics.initNavGrid3D(openGrid(4, 4, 4));
      const before = physics.findPath3D(start, goal);

      const err = caught(() =>
        physics.initNavGrid3D({
          grid: new Uint8Array(0),
          width: 0,
          height: 1,
          depth: 1,
          cellSize,
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
      const after = physics.findPath3D(start, goal);
      expect(after).toEqual(before);
      expectNearGoal(after);
    } finally {
      await handle.dispose();
    }
  });

  it("a grid of 64x64x64 cells is accepted and 64x64x65 is refused with PHYSICS3D:INVALID_NAVGRID", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      physics.initNavGrid3D(openGrid(64, 64, 64));

      const err = caught(() => physics.initNavGrid3D(openGrid(64, 64, 65)));

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
      expect(
        physics.findPath3D({ x: 0.5, y: 0.5, z: 0.5 }, { x: 2.5, y: 0.5, z: 0.5 }).length,
      ).toBeGreaterThan(0);
    } finally {
      await handle.dispose();
    }
  });

  it("a non-finite findPath3D request throws PHYSICS3D:INVALID_PATH_REQUEST", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);
      // With no grid, findPath3D returns [] for NAVGRID_NOT_INITIALIZED and never checks NaN.
      physics.initNavGrid3D(openGrid(4, 4, 4));

      const err = caught(() =>
        physics.findPath3D({ x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_PATH_REQUEST", "physics3d_find_path_3d");
    } finally {
      await handle.dispose();
    }
  });

  it("the upload buffer is released when the export throws", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    const allocated = recordAlloc(handle);
    try {
      const physics = await startPhysics(handle);

      const refused = caught(() =>
        physics.initNavGrid3D({
          grid: new Uint8Array(0),
          width: 0,
          height: 1,
          depth: 1,
          cellSize,
        }),
      );
      expectUploadReleased(handle, allocated, 0);
      requireWasmError(refused, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");

      const before = allocated.length;
      physics.initNavGrid3D(openGrid(4, 4, 4));
      expectUploadReleased(handle, allocated, before);
    } finally {
      await handle.dispose();
    }
  });

  it("a grid shorter than its dimensions throws PHYSICS3D:INVALID_NAVGRID", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    const allocated = recordAlloc(handle);
    try {
      const physics = await startPhysics(handle);
      physics.initNavGrid3D(openGrid(4, 4, 4));
      const before = physics.findPath3D(start, goal);

      const err = caught(() =>
        physics.initNavGrid3D({
          grid: new Uint8Array(8),
          width: 4,
          height: 4,
          depth: 4,
          cellSize,
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
      const after = physics.findPath3D(start, goal);
      expect(after).toEqual(before);
      expectNearGoal(after);
      expectUploadReleased(handle, allocated, 1);
    } finally {
      await handle.dispose();
    }
  });

  it("a grid longer than its dimensions throws PHYSICS3D:INVALID_NAVGRID", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    const allocated = recordAlloc(handle);
    try {
      const physics = await startPhysics(handle);
      physics.initNavGrid3D(openGrid(4, 4, 4));
      const before = physics.findPath3D(start, goal);

      const err = caught(() =>
        physics.initNavGrid3D({
          grid: new Uint8Array(10),
          width: 3,
          height: 1,
          depth: 3,
          cellSize,
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
      const after = physics.findPath3D(start, goal);
      expect(after).toEqual(before);
      expectNearGoal(after);
      expectUploadReleased(handle, allocated, 1);
    } finally {
      await handle.dispose();
    }
  });

  it("an empty grid with zero dimensions throws PHYSICS3D:INVALID_NAVGRID", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const physics = await startPhysics(handle);

      const err = caught(() =>
        physics.initNavGrid3D({
          grid: new Uint8Array(0),
          width: 0,
          height: 0,
          depth: 0,
          cellSize,
        }),
      );

      requireWasmError(err, "PHYSICS3D:INVALID_NAVGRID", "physics3d_init_navgrid_3d");
    } finally {
      await handle.dispose();
    }
  });

  it("two physics3d engines keep separate nav grids", async () => {
    const engineA = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const engineB = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
      try {
        const physicsA = await startPhysics(engineA);
        const physicsB = await startPhysics(engineB);
        physicsA.initNavGrid3D(openGrid(4, 4, 4));

        expectNearGoal(physicsA.findPath3D(start, goal));
        expect(physicsB.findPath3D(start, goal)).toEqual([]);
      } finally {
        await engineB.dispose();
      }
    } finally {
      await engineA.dispose();
    }
  });
});

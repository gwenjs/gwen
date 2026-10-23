/**
 * @fileoverview Pathfinding service methods for the Physics3D API.
 */

import type { Physics3DAPI, Physics3DVec3, Pathfinding3DOptions, PathWaypoint3D } from "../types";
import { Physics3DErrorCodes } from "../errors/codes";
import { localFindPath3D } from "./pathfinding";
import type { PluginContext } from "./plugin-context";
import { callPhysics3DExport, hasPhysics3DCode } from "./wasm-errors";

export function createPathfindingMethods(
  ctx: PluginContext,
): Pick<Physics3DAPI, "initNavGrid3D" | "findPath3D"> {
  return {
    initNavGrid3D(opts: Pathfinding3DOptions): void {
      if (ctx.backendMode === "wasm") {
        const pb = ctx.wasmBridge!;
        callPhysics3DExport(ctx, "physics3d_init_navgrid_3d", () =>
          pb.physics3d_init_navgrid_3d?.(
            opts.grid,
            opts.width,
            opts.height,
            opts.depth,
            opts.cellSize,
            opts.origin?.x ?? 0,
            opts.origin?.y ?? 0,
            opts.origin?.z ?? 0,
          ),
        );
        return;
      }
      // Local mode: store for JS A* use
      ctx._localNavGrid = opts;
    },

    findPath3D(from: Physics3DVec3, to: Physics3DVec3): PathWaypoint3D[] {
      if (ctx.backendMode === "wasm") {
        let count: number | undefined;
        try {
          count = callPhysics3DExport(ctx, "physics3d_find_path_3d", () =>
            ctx.wasmBridge!.physics3d_find_path_3d?.(from.x, from.y, from.z, to.x, to.y, to.z),
          );
        } catch (err: unknown) {
          // Documented contract: no grid uploaded yields an empty path. Other codes throw.
          if (hasPhysics3DCode(err, Physics3DErrorCodes.NAVGRID_NOT_INITIALIZED)) return [];
          throw err;
        }
        if (!count || count === 0) return [];
        const ptr = ctx.wasmBridge!.physics3d_get_path_buffer_ptr_3d?.();
        if (!ptr) return [];
        const wasmMem = ctx.bridgeRuntime?.getLinearMemory?.();
        if (!wasmMem) return [];
        const floats = new Float32Array(wasmMem.buffer, ptr, count * 3);
        const path: PathWaypoint3D[] = [];
        for (let i = 0; i < count; i++) {
          path.push({
            x: floats[i * 3]!,
            y: floats[i * 3 + 1]!,
            z: floats[i * 3 + 2]!,
          });
        }
        return path;
      }
      return localFindPath3D(ctx, from, to);
    },
  };
}

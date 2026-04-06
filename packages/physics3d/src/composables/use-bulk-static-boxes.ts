import { usePhysics3D } from '../composables';
import type { BulkStaticBoxesOptions, BulkStaticBoxesResult } from '../types';

/**
 * Spawn N static box bodies in one call from inside an actor or system setup().
 *
 * Internally delegates to {@link Physics3DAPI.bulkSpawnStaticBoxes}. Prefer this
 * composable over looping `useStaticBody` when placing large amounts of static
 * geometry (platforms, walls, terrain tiles) — the WASM backend processes all N
 * boxes in a single Rust call.
 *
 * @param options - Position buffer, half-extents, and optional material overrides.
 * @returns The result containing all spawned entity IDs and count.
 *
 * @example
 * ```ts
 * const { entityIds } = useBulkStaticBoxes({
 *   positions: new Float32Array([0,0,0, 5,0,0, 10,0,0]),
 *   halfExtents: new Float32Array([0.5, 0.5, 0.5]),
 *   friction: 0.6,
 * });
 * ```
 */
export function useBulkStaticBoxes(options: BulkStaticBoxesOptions): BulkStaticBoxesResult {
  const physics = usePhysics3D();
  return physics.bulkSpawnStaticBoxes(options);
}

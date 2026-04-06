/**
 * @file useHeightfieldCollider() — attaches a grid-based heightfield collider
 * to the current entity for efficient terrain collision.
 */
import type { HeightfieldColliderHandle3D, Physics3DMaterialPreset } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { nextColliderId } from './collider-id';

/**
 * Options for configuring a grid-based heightfield 3D collider.
 */
export interface HeightfieldColliderOptions {
  /**
   * Row-major flat array of `rows × cols` height values.
   * Index `[r * cols + c]` gives the height at row `r`, column `c`.
   */
  heights: Float32Array;
  /** Number of rows (Z axis). Must be ≥ 2. */
  rows: number;
  /** Number of columns (X axis). Must be ≥ 2. */
  cols: number;
  /** World-space width of the entire heightfield in metres. @default 1 */
  scaleX?: number;
  /** World-space maximum height multiplier in metres. @default 1 */
  scaleY?: number;
  /** World-space depth of the entire heightfield in metres. @default 1 */
  scaleZ?: number;
  /** Surface friction coefficient (≥ 0). @default 0.5 */
  friction?: number;
  /** Bounciness [0, 1]. @default 0 */
  restitution?: number;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset controlling friction and restitution. @default 'default' */
  material?: Physics3DMaterialPreset;
}

/**
 * Attach a grid-based heightfield collider to the current entity.
 *
 * The heightfield is 40× more memory-efficient than a trimesh for regular
 * terrain grids. Use it for open-world terrain, RTS maps, and racing tracks.
 *
 * Must be called after {@link useStaticBody} has registered the body for this
 * entity.
 *
 * @param options - Grid dimensions, height data, scale, and optional material config.
 * @returns A {@link HeightfieldColliderHandle3D} with a stable `colliderId`,
 *   an `update()` method for deformable terrain, and a `remove()` method.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const ROWS = 64;
 * const COLS = 64;
 * const heights = new Float32Array(ROWS * COLS).fill(0);
 *
 * const TerrainActor = defineActor(TerrainPrefab, () => {
 *   useStaticBody()
 *   const terrain = useHeightfieldCollider({
 *     heights,
 *     rows: ROWS,
 *     cols: COLS,
 *     scaleX: 128,
 *     scaleY: 20,
 *     scaleZ: 128,
 *   })
 *
 *   // Deform a single cell at runtime:
 *   onUpdate(() => {
 *     heights[32 * COLS + 32] += 0.01
 *     terrain.update(heights)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useHeightfieldCollider(
  options: HeightfieldColliderOptions,
): HeightfieldColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const colliderId = nextColliderId();

  const scaleX = options.scaleX ?? 1;
  const scaleY = options.scaleY ?? 1;
  const scaleZ = options.scaleZ ?? 1;

  const buildColliderOptions = (heights: Float32Array) => ({
    shape: {
      type: 'heightfield' as const,
      heights,
      rows: options.rows,
      cols: options.cols,
      scaleX,
      scaleY,
      scaleZ,
    },
    friction: options.friction,
    restitution: options.restitution,
    layers: options.layer !== undefined ? [options.layer] : undefined,
    mask: options.mask !== undefined ? [options.mask] : undefined,
    materialPreset: options.material,
    colliderId,
  });

  physics.addCollider(entityId, buildColliderOptions(options.heights));

  return {
    get colliderId() {
      return colliderId;
    },
    update(newHeights: Float32Array) {
      physics.removeCollider(entityId, colliderId);
      physics.addCollider(entityId, buildColliderOptions(newHeights));
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}

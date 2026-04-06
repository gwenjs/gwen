/**
 * @file useConvexCollider() — attaches a convex hull collider to the current entity.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 *
 * A convex collider computes the convex hull of a point cloud. It is significantly
 * cheaper than a trimesh collider and suitable for dynamic bodies when primitive
 * shapes (box, sphere, capsule) do not approximate the geometry closely enough.
 */
import type { ConvexColliderHandle3D, Physics3DMaterialPreset } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { nextColliderId } from './collider-id';

/**
 * Options for configuring a convex hull 3D collider.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 */
export interface ConvexColliderOptions {
  /**
   * Flat array of vertex positions in metres.
   * Layout: `[x0, y0, z0, x1, y1, z1, ...]`.
   * The Rapier3D engine computes the convex hull automatically.
   * Length must be a multiple of 3.
   */
  vertices: Float32Array;
  /** Mark as sensor — generates events but no physical response. @default false */
  isSensor?: boolean;
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset controlling friction and restitution. @default 'default' */
  material?: Physics3DMaterialPreset;
}

/**
 * Attach a convex hull collider to the current entity.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered the body for this entity.
 *
 * @param options - Vertex point cloud and optional material/sensor/layer config.
 * @returns A {@link ConvexColliderHandle3D} with a stable `colliderId` and a `remove()` method.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const CrateActor = defineActor(CratePrefab, () => {
 *   useDynamicBody({ mass: 50 })
 *   useConvexCollider({ vertices: cratePoints })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useConvexCollider(options: ConvexColliderOptions): ConvexColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const colliderId = nextColliderId();

  physics.addCollider(entityId, {
    shape: {
      type: 'convex',
      vertices: options.vertices,
    },
    isSensor: options.isSensor,
    materialPreset: options.material,
    colliderId,
  });

  return {
    get colliderId() {
      return colliderId;
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}

/**
 * @file useConvexCollider() — attaches a convex hull collider to the current entity.
 *
 * **3D only — not available in \@gwenjs/physics2d.**
 *
 * A convex collider computes the convex hull of a point cloud. It is significantly
 * cheaper than a trimesh collider and suitable for dynamic bodies when primitive
 * shapes (box, sphere, capsule) do not approximate the geometry closely enough.
 */
import type { LayerSelector } from "@gwenjs/physics-core";
import type { ConvexColliderHandle3D, Physics3DColliderOptions } from "../types";
import { usePhysics3D } from "../composables";
import { _getActorEntityId } from "@gwenjs/core/internal";
import { nextColliderId } from "./collider-id";

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
  /** Collision layer. A number is a raw bitmask, a string is a name, an array is OR-ed. */
  layer?: LayerSelector;
  /** Collision mask. Same shapes as `layer`. */
  mask?: LayerSelector;
  /** Preset name. */
  material?: string;
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
  const entityId = _getActorEntityId("useConvexCollider");
  const colliderId = nextColliderId();

  const collider: Physics3DColliderOptions = {
    shape: {
      type: "convex",
      vertices: options.vertices,
    },
    colliderId,
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  };
  if (options.material !== undefined) Object.assign(collider, { material: options.material });
  physics.addCollider(entityId, collider);

  return {
    get colliderId() {
      return colliderId;
    },
    remove() {
      physics.removeCollider(entityId, colliderId);
    },
  };
}

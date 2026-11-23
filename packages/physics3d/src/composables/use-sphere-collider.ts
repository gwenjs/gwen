/**
 * @file useSphereCollider() — attaches a sphere-shaped collider to the current entity.
 */
import type { LayerSelector } from "@gwenjs/physics-core";
import type { SphereColliderHandle3D, Physics3DColliderOptions } from "../types";
import { usePhysics3D } from "../composables";
import { _getActorEntityId } from "@gwenjs/core/internal";
import { nextColliderId } from "./collider-id";

/**
 * Options for configuring a sphere-shaped 3D collider.
 */
export interface SphereColliderOptions3D {
  /** Sphere radius in metres. */
  radius: number;
  /** Local-space X offset of the collider centre relative to the body origin. */
  offsetX?: number;
  /** Local-space Y offset of the collider centre relative to the body origin. */
  offsetY?: number;
  /** Local-space Z offset of the collider centre relative to the body origin. */
  offsetZ?: number;
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
 * Attach a sphere-shaped collider to the current entity.
 *
 * Must be called after {@link useStaticBody} or {@link useDynamicBody} has
 * registered the body for this entity.
 *
 * @param options - Sphere radius and optional material/sensor/layer config.
 * @returns A {@link SphereColliderHandle3D} with a stable `colliderId` and a `remove()` method.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const BallActor = defineActor(BallPrefab, () => {
 *   useDynamicBody({ mass: 1 })
 *   useSphereCollider({ radius: 0.5 })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useSphereCollider(options: SphereColliderOptions3D): SphereColliderHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId("useSphereCollider");
  const colliderId = nextColliderId();

  const collider: Physics3DColliderOptions = {
    shape: {
      type: "sphere",
      radius: options.radius,
    },
    colliderId,
    ...(options.offsetX !== undefined ? { offsetX: options.offsetX } : {}),
    ...(options.offsetY !== undefined ? { offsetY: options.offsetY } : {}),
    ...(options.offsetZ !== undefined ? { offsetZ: options.offsetZ } : {}),
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
    ...(options.material !== undefined ? { material: options.material } : {}),
  };
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

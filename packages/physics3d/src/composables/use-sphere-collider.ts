/**
 * @file useSphereCollider() — attaches a sphere-shaped collider to the current entity.
 */
import type { SphereColliderHandle3D, Physics3DMaterialPreset } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { nextColliderId } from './collider-id';

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
  /** Numeric collision layer bitmask (membership). */
  layer?: number;
  /** Numeric collision filter bitmask (which layers to collide with). */
  mask?: number;
  /** Built-in material preset controlling friction and restitution. @default 'default' */
  material?: Physics3DMaterialPreset;
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
  const entityId = _getActorEntityId() as unknown as EntityId;
  const colliderId = nextColliderId();

  physics.addCollider(entityId, {
    shape: {
      type: 'sphere',
      radius: options.radius,
    },
    offsetX: options.offsetX,
    offsetY: options.offsetY,
    offsetZ: options.offsetZ,
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

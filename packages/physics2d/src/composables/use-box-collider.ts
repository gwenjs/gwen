/**
 * @file useBoxCollider() — explicit box collider shape composable.
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type { BoxColliderHandle } from '../types';
import { usePhysics2D } from '../composables';

export interface BoxColliderOptions {
  /** Width of the box collider in world units. */
  w: number;
  /** Height of the box collider in world units. */
  h: number;
  /** Depth — ignored in 2D, accepted for 2D/3D structural compatibility. */
  d?: number;
  /** Local X offset of the collider from the entity origin. @default 0 */
  offsetX?: number;
  /** Local Y offset of the collider from the entity origin. @default 0 */
  offsetY?: number;
  /** If true, generates overlap events but no physical response. @default false */
  isSensor?: boolean;
  /** Collision membership layer bitmask. @default undefined */
  layer?: number;
  /** Collision filter mask bitmask. @default undefined */
  mask?: number;
}

/**
 * Attaches a box collider to the current actor entity.
 *
 * Creates a fixed body at the given offset and attaches an axis-aligned box collider
 * with the specified half-extents.
 *
 * @param options - Box dimensions and collider options.
 * @returns A {@link BoxColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {Error} If called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * useBoxCollider({ w: 32, h: 32, layer: Layers.player, mask: Layers.wall })
 * ```
 *
 * @since 1.0.0
 */
export function useBoxCollider(options: BoxColliderOptions): BoxColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  const bodyHandle = physics.addRigidBody(
    entityId,
    'fixed',
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  physics.addBoxCollider(bodyHandle, options.w / 2, options.h / 2, {
    isSensor: options.isSensor,
    membershipLayers: options.layer,
    filterLayers: options.mask,
  });

  return {
    colliderId: bodyHandle,
    isSensor: options.isSensor ?? false,
  };
}

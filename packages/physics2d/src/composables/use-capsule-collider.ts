/**
 * @file useCapsuleCollider() — capsule collider composable.
 *
 * Note: `Physics2DAPI` does not have a native capsule primitive.
 * This composable approximates a capsule using a box collider with half-extents
 * derived from `radius` (width) and `height/2` (half-height).
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type { CapsuleColliderHandle } from '../types';
import { usePhysics2D } from '../composables';

export interface CapsuleColliderOptions {
  /** Capsule radius (used as box half-width). */
  radius: number;
  /** Total capsule height (box half-height = height / 2). */
  height: number;
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
 * Attaches a capsule collider to the current actor entity.
 *
 * Since `Physics2DAPI` does not expose a capsule primitive, this composable
 * uses a box collider as an approximation (`hw = radius`, `hh = height / 2`).
 *
 * @param options - Capsule dimensions and collider options.
 * @returns A {@link CapsuleColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {Error} If called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * useCapsuleCollider({ radius: 10, height: 40, layer: Layers.player })
 * ```
 *
 * @since 1.0.0
 */
export function useCapsuleCollider(options: CapsuleColliderOptions): CapsuleColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  const bodyHandle = physics.addRigidBody(
    entityId,
    'fixed',
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  // Approximate capsule with a box collider (Physics2DAPI has no capsule primitive)
  physics.addBoxCollider(bodyHandle, options.radius, options.height / 2, {
    isSensor: options.isSensor,
    membershipLayers: options.layer,
    filterLayers: options.mask,
  });

  return { colliderId: bodyHandle, isSensor: options.isSensor ?? false };
}

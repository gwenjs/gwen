/**
 * @file useSphereCollider() — circle collider for 2D (sphere for structural 3D compat).
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type { CircleColliderHandle } from '../types';
import { usePhysics2D } from '../composables';

export interface SphereColliderOptions {
  /** Circle radius in world units. */
  radius: number;
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
 * Attaches a circle (sphere) collider to the current actor entity.
 * The name `useSphereCollider` is kept for 2D/3D structural compatibility.
 *
 * @param options - Radius and collider options.
 * @returns A {@link CircleColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {Error} If called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * const zone = useSphereCollider({ radius: 64, isSensor: true })
 * onSensorEnter(zone.colliderId, (playerId) => { ... })
 * ```
 *
 * @since 1.0.0
 */
export function useSphereCollider(options: SphereColliderOptions): CircleColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  const bodyHandle = physics.addRigidBody(
    entityId,
    'fixed',
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  physics.addBallCollider(bodyHandle, options.radius, {
    isSensor: options.isSensor,
    membershipLayers: options.layer,
    filterLayers: options.mask,
  });

  return { colliderId: bodyHandle, isSensor: options.isSensor ?? false };
}

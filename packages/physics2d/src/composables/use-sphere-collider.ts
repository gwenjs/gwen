/**
 * @file useSphereCollider() — circle collider for 2D (sphere for structural 3D compat).
 */
import { _getActorEntityId } from "@gwenjs/core/internal";
import type { SphereColliderOptions } from "@gwenjs/physics-core";
import type { CircleColliderHandle } from "../types";
import { usePhysics2D } from "../composables";

/**
 * Attaches a circle (sphere) collider to the current actor entity.
 * The name `useSphereCollider` is kept for 2D/3D structural compatibility.
 *
 * @param options - Radius and collider options. `material` is accepted by the shared type and not applied by physics2d yet.
 * @returns A {@link CircleColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` if called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * const zone = useSphereCollider({ radius: 64, isSensor: true })
 * onSensorEnter(zone.colliderId, (playerId) => { ... })
 * ```
 *
 * @since 1.0.0
 */
export function useSphereCollider(options: SphereColliderOptions<"2d">): CircleColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId("useSphereCollider");

  const bodyHandle = physics.addRigidBody(
    entityId,
    "fixed",
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  physics.addBallCollider(bodyHandle, options.radius, {
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  });

  return { colliderId: bodyHandle, isSensor: options.isSensor ?? false };
}

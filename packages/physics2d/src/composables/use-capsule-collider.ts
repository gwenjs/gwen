/**
 * @file useCapsuleCollider() — capsule collider composable.
 *
 * Note: `Physics2DAPI` does not have a native capsule primitive.
 * This composable approximates a capsule using a box collider with half-extents
 * derived from `radius` (width) and `height/2` (half-height).
 */
import { _getActorEntityId } from "@gwenjs/core/internal";
import type { CapsuleColliderOptions } from "@gwenjs/physics-core";
import type { CapsuleColliderHandle } from "../types";
import { usePhysics2D } from "../composables";

/**
 * Attaches a capsule collider to the current actor entity.
 *
 * Since `Physics2DAPI` does not expose a capsule primitive, this composable
 * uses a box collider as an approximation (`hw = radius`, `hh = height / 2`).
 *
 * @param options - Capsule dimensions and collider options. `material` is accepted by the shared type and not applied by physics2d yet.
 * @returns A {@link CapsuleColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` if called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * useCapsuleCollider({ radius: 10, height: 40, layer: Layers.player })
 * ```
 *
 * @since 1.0.0
 */
export function useCapsuleCollider(options: CapsuleColliderOptions<"2d">): CapsuleColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId("useCapsuleCollider");

  const bodyHandle = physics.addRigidBody(
    entityId,
    "fixed",
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  // Approximate capsule with a box collider (Physics2DAPI has no capsule primitive)
  physics.addBoxCollider(bodyHandle, options.radius, options.height / 2, {
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  });

  return { colliderId: bodyHandle, isSensor: options.isSensor ?? false };
}

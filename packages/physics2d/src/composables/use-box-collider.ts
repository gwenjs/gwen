/**
 * @file useBoxCollider() — explicit box collider shape composable.
 */
import { _getActorEntityId } from "@gwenjs/core/internal";
import type { BoxColliderOptions } from "@gwenjs/physics-core";
import type { BoxColliderHandle } from "../types";
import { usePhysics2D } from "../composables";

/**
 * Attaches a box collider to the current actor entity.
 *
 * Creates a fixed body at the given offset and attaches an axis-aligned box collider
 * with the specified half-extents.
 *
 * @param options - Box dimensions and collider options. `material` is accepted by the shared type and not applied by physics2d yet.
 * @returns A {@link BoxColliderHandle} with the collider ID.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` if called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * useBoxCollider({ w: 32, h: 32, layer: Layers.player, mask: Layers.wall })
 * ```
 *
 * @since 1.0.0
 */
export function useBoxCollider(options: BoxColliderOptions<"2d">): BoxColliderHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId("useBoxCollider");

  const bodyHandle = physics.addRigidBody(
    entityId,
    "fixed",
    options.offsetX ?? 0,
    options.offsetY ?? 0,
  );

  physics.addBoxCollider(bodyHandle, options.w / 2, options.h / 2, {
    ...(options.isSensor !== undefined ? { isSensor: options.isSensor } : {}),
    ...(options.layer !== undefined ? { layer: options.layer } : {}),
    ...(options.mask !== undefined ? { mask: options.mask } : {}),
  });

  return {
    colliderId: bodyHandle,
    isSensor: options.isSensor ?? false,
  };
}

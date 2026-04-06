/**
 * @file useRaycast() — registers a persistent per-frame raycast slot for the scene.
 */
import { usePhysics3D } from '../composables';
import type { RaycastOpts, RaycastHandle } from '../types';

/**
 * Extended handle returned by {@link useRaycast}.
 *
 * Extends {@link RaycastHandle} with a `dispose()` method that unregisters
 * the slot and frees its backing resources.
 */
export interface UseRaycastHandle extends RaycastHandle {
  /** Unregisters this raycast slot and frees its resources. */
  dispose(): void;
}

/**
 * Registers a persistent per-frame raycast slot.
 *
 * The returned handle's properties (`hit`, `entity`, `distance`, `normal`,
 * `point`) are updated in-place after every physics step — no allocation
 * occurs on hot paths. Call `handle.dispose()` when the slot is no longer
 * needed.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @param opts - Ray direction, max distance, layer masks, solid flag, and
 *   optional per-frame origin callback.
 * @returns A {@link UseRaycastHandle} with reactive hit properties and a
 *   `dispose()` method.
 * @throws {GwenPluginNotFoundError} If `physics3dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * const GroundSensor = defineSystem(() => {
 *   const ray = useRaycast({
 *     origin: () => ({ x: player.x, y: player.y + 0.1, z: player.z }),
 *     direction: { x: 0, y: -1, z: 0 },
 *     maxDist: 0.5,
 *   })
 *   onUpdate(() => {
 *     if (ray.hit) console.log('on ground, distance:', ray.distance)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useRaycast(opts: RaycastOpts): UseRaycastHandle {
  const physics = usePhysics3D();
  const handle = physics.registerRaycastSlot(opts);

  return {
    get hit() {
      return handle.hit;
    },
    get entity() {
      return handle.entity;
    },
    get distance() {
      return handle.distance;
    },
    get normal() {
      return handle.normal;
    },
    get point() {
      return handle.point;
    },
    get _id() {
      return handle._id;
    },
    dispose() {
      physics.unregisterRaycastSlot(handle);
    },
  };
}

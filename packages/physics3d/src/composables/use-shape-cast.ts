/**
 * @file useShapeCast() — registers a persistent per-frame shape-cast slot for the scene.
 */
import { usePhysics3D } from '../composables';
import type { ShapeCastOpts, ShapeCastHandle } from '../types';

/**
 * Extended handle returned by {@link useShapeCast}.
 *
 * Extends {@link ShapeCastHandle} with a `dispose()` method that unregisters
 * the slot and frees its backing resources.
 */
export interface UseShapeCastHandle extends ShapeCastHandle {
  /** Unregisters this shape-cast slot and frees its resources. */
  dispose(): void;
}

/**
 * Registers a persistent per-frame shape-cast (swept-shape) slot.
 *
 * The returned handle's properties (`hit`, `entity`, `distance`, `normal`,
 * `point`, `witnessA`, `witnessB`) are updated in-place after every physics
 * step — no allocation occurs on hot paths. Call `handle.dispose()` when the
 * slot is no longer needed.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @param opts - Cast shape, direction, max distance, layer masks, and optional
 *   per-frame origin/rotation callbacks.
 * @returns A {@link UseShapeCastHandle} with reactive hit properties and a
 *   `dispose()` method.
 * @throws {GwenPluginNotFoundError} If `physics3dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * const WallProbe = defineSystem(() => {
 *   const cast = useShapeCast({
 *     shape: { type: 'sphere', radius: 0.3 },
 *     origin: () => ({ x: actor.x, y: actor.y, z: actor.z }),
 *     direction: { x: 0, y: 0, z: 1 },
 *     maxDist: 1.0,
 *   })
 *   onUpdate(() => {
 *     if (cast.hit) console.log('wall ahead at distance:', cast.distance)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useShapeCast(opts: ShapeCastOpts): UseShapeCastHandle {
  const physics = usePhysics3D();
  const handle = physics.registerShapeCastSlot(opts);

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
    get witnessA() {
      return handle.witnessA;
    },
    get witnessB() {
      return handle.witnessB;
    },
    get _id() {
      return handle._id;
    },
    dispose() {
      physics.unregisterShapeCastSlot(handle);
    },
  };
}

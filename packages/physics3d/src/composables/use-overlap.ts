/**
 * @file useOverlap() — registers a persistent per-frame overlap query slot for the scene.
 */
import { usePhysics3D } from '../composables';
import type { OverlapOpts, OverlapHandle } from '../types';

/**
 * Extended handle returned by {@link useOverlap}.
 *
 * Extends {@link OverlapHandle} with a `dispose()` method that unregisters
 * the slot and frees its backing resources.
 */
export interface UseOverlapHandle extends OverlapHandle {
  /** Unregisters this overlap slot and frees its resources. */
  dispose(): void;
}

/**
 * Registers a persistent per-frame overlap (intersection) query slot.
 *
 * The returned handle's properties (`count`, `entities`) are updated in-place
 * after every physics step — no allocation occurs beyond the initial slot
 * setup. Call `handle.dispose()` when the slot is no longer needed.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @param opts - Query shape, layer masks, max results, and per-frame origin
 *   callback (required). An optional rotation callback may also be supplied.
 * @returns A {@link UseOverlapHandle} with a reactive entity list and a
 *   `dispose()` method.
 * @throws {GwenPluginNotFoundError} If `physics3dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * const TriggerZone = defineSystem(() => {
 *   const zone = useOverlap({
 *     shape: { type: 'box', hx: 2, hy: 1, hz: 2 },
 *     origin: () => ({ x: door.x, y: door.y, z: door.z }),
 *     maxResults: 8,
 *   })
 *   onUpdate(() => {
 *     if (zone.count > 0) openDoor()
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useOverlap(opts: OverlapOpts): UseOverlapHandle {
  const physics = usePhysics3D();
  const handle = physics.registerOverlapSlot(opts);

  return {
    get count() {
      return handle.count;
    },
    get entities() {
      return handle.entities;
    },
    get _id() {
      return handle._id;
    },
    dispose() {
      physics.unregisterOverlapSlot(handle);
    },
  };
}

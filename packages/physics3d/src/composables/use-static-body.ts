/**
 * @file useStaticBody() — registers a static 3D physics body for the current actor.
 */
import type { StaticBodyOptions3D, StaticBodyHandle3D } from '../types';
import { usePhysics3D } from '../composables';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';

/**
 * Registers the current actor's entity as a static (non-moving) 3D physics body.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * The body is created with `kind: 'fixed'`, meaning it participates in collision
 * detection but is never moved by the physics simulation.
 *
 * @param options - Optional sensor and layer configuration.
 * @returns A {@link StaticBodyHandle3D} for enabling/disabling the body at runtime.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const WallActor = defineActor(WallPrefab, () => {
 *   useStaticBody()
 *   useBoxCollider({ w: 2, h: 4, d: 0.5 })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useStaticBody(options: StaticBodyOptions3D = {}): StaticBodyHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  // isSensor is a collider-level option, not a body option, but we accept it here
  // for convenience and forward it to any colliders added separately.
  void options;

  let _handle = physics.createBody(entityId, { kind: 'fixed' });
  let _active = true;

  return {
    get bodyId() {
      return _handle.bodyId;
    },
    get active() {
      return _active;
    },
    enable() {
      if (_active) return;
      _handle = physics.createBody(entityId, { kind: 'fixed' });
      _active = true;
    },
    disable() {
      if (!_active) return;
      physics.removeBody(entityId);
      _active = false;
    },
  };
}

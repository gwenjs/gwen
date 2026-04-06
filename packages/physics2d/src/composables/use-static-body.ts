/**
 * @file useStaticBody() — registers a static (non-moving) physics body for the current actor.
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { useEngine } from '@gwenjs/core';
import type { StaticBodyHandle, StaticBodyOptions, ColliderOptions } from '../types';
import { usePhysics2D } from '../composables';
import { ShapeComponent } from '../shape-component';

/**
 * Registers the current actor's entity as a static (non-moving) physics body.
 *
 * Must be called inside a `defineActor()` factory function so that the entity ID
 * can be resolved from the active actor spawn context.
 *
 * @param options - Optional body and collider configuration.
 * @returns A {@link StaticBodyHandle} for enabling/disabling the body at runtime.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {Error} If called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * const GroundActor = defineActor(GroundPrefab, () => {
 *   const body = useStaticBody({ shape: 'box', layer: Layers.wall })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useStaticBody(options: StaticBodyOptions = {}): StaticBodyHandle {
  const physics = usePhysics2D();
  const engine = useEngine();
  const entityId = _getActorEntityId() as unknown as EntityId;

  // Stored creation options so enable() can re-register the body after disable().
  const colliderOpts: ColliderOptions = {
    isSensor: options.isSensor,
    membershipLayers: options.layer,
    filterLayers: options.mask,
  };

  let _bodyHandle: number;

  /** Register the rigid body and collider with the physics system. */
  function _createBody(): void {
    _bodyHandle = physics.addRigidBody(entityId, 'fixed', 0, 0);

    // Read shared Shape component for dimensions — allows useShape() to set once per actor.
    const shapeData = engine.getComponent(entityId, ShapeComponent);

    if (options.shape === 'ball') {
      const radius = shapeData?.radius && shapeData.radius > 0 ? shapeData.radius : 0.5;
      physics.addBallCollider(_bodyHandle, radius, colliderOpts);
    } else {
      // Default to box collider for 'box', 'capsule', or unspecified shape
      const hw = shapeData?.w && shapeData.w > 0 ? shapeData.w / 2 : 0.5;
      const hh = shapeData?.h && shapeData.h > 0 ? shapeData.h / 2 : 0.5;
      physics.addBoxCollider(_bodyHandle, hw, hh, colliderOpts);
    }
  }

  _createBody();
  let _active = true;

  return {
    get bodyId() {
      return _bodyHandle;
    },
    get active() {
      return _active;
    },
    enable() {
      if (!_active) {
        // Re-register the body so physics calls operate on a valid body handle.
        _createBody();
        _active = true;
      }
    },
    disable() {
      if (_active) {
        physics.removeBody(entityId);
        _active = false;
      }
    },
  };
}

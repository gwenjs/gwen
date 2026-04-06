/**
 * @file useDynamicBody() — registers a dynamic physics body for the current actor.
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type { DynamicBodyHandle, DynamicBodyOptions, ColliderOptions } from '../types';
import { usePhysics2D } from '../composables';

/**
 * Registers the current actor's entity as a dynamic (physics-simulated) body.
 *
 * Must be called inside a `defineActor()` factory function.
 *
 * @param options - Dynamic body configuration.
 * @returns A {@link DynamicBodyHandle} for applying impulses and reading velocity.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 * @throws {Error} If called outside a `defineActor()` factory.
 *
 * @example
 * ```typescript
 * const PlayerActor = defineActor(PlayerPrefab, () => {
 *   const body = useDynamicBody({ fixedRotation: true, gravityScale: 2.5 })
 *   onUpdate(() => { if (grounded) body.applyImpulse(0, 400) })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useDynamicBody(options: DynamicBodyOptions = {}): DynamicBodyHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId() as unknown as EntityId;

  if (options.fixedRotation) {
    console.warn(
      '[gwen:physics2d] fixedRotation is not yet supported by Physics2DAPI. The option is accepted but has no effect.',
    );
  }

  // Stored creation options so enable() can re-register the body after disable().
  const rigidBodyOpts = {
    mass: options.mass,
    linearDamping: options.linearDamping,
    angularDamping: options.angularDamping,
    gravityScale: options.gravityScale,
  };

  const colliderOpts: ColliderOptions = {
    membershipLayers: options.layer,
    filterLayers: options.mask,
  };

  let _bodyHandle: number;

  /** Register the rigid body and collider with the physics system. */
  function _createBody(): void {
    _bodyHandle = physics.addRigidBody(entityId, 'dynamic', 0, 0, rigidBodyOpts);
    if (options.shape === 'ball') {
      physics.addBallCollider(_bodyHandle, 0.5, colliderOpts);
    } else {
      physics.addBoxCollider(_bodyHandle, 0.5, 0.5, colliderOpts);
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
    get velocity() {
      return physics.getLinearVelocity(entityId) ?? { x: 0, y: 0 };
    },
    /**
     * Apply a continuous force to the body.
     * Note: Physics2DAPI has no direct `applyForce`; this is a no-op.
     * Use `applyImpulse` for instantaneous velocity changes.
     */
    applyForce(_fx: number, _fy: number) {
      // TODO: Physics2DAPI does not expose applyForce — use applyImpulse instead.
    },
    applyImpulse(ix: number, iy: number) {
      physics.applyImpulse(entityId, ix, iy);
    },
    setVelocity(vx: number, vy: number) {
      physics.setLinearVelocity(entityId, vx, vy);
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

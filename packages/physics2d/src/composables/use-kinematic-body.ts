/**
 * @file useKinematicBody() — registers a kinematic 2D physics body for the current actor.
 *
 * A kinematic body participates in collision detection and pushes dynamic bodies
 * out of its path, but is **never displaced by forces or gravity**. Its position
 * is driven entirely by {@link KinematicBodyHandle.setVelocity} +
 * `onBeforeUpdate` integration, or by explicit {@link KinematicBodyHandle.moveTo} calls.
 */
import { onBeforeUpdate } from '@gwenjs/core';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type { KinematicBodyOptions, KinematicBodyHandle } from '../types';
import { usePhysics2D } from '../composables';

/**
 * Registers the current actor's entity as a kinematic 2D physics body.
 *
 * Must be called inside a `defineActor()` factory function or any active
 * engine context (`defineSystem()`, `engine.run()`).
 *
 * @param options - Initial position, angle, and rotation lock configuration.
 * @returns A {@link KinematicBodyHandle} for controlling position and velocity.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics2d` is not registered.
 *
 * @example
 * ```typescript
 * const KartActor = defineActor(KartPrefab, () => {
 *   const body = useKinematicBody({ fixedRotation: false })
 *   useBoxCollider({ w: 1.2, h: 0.6 })
 *
 *   onUpdate(() => {
 *     body.setVelocity(input.x * SPEED, input.y * SPEED)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useKinematicBody(options: KinematicBodyOptions = {}): KinematicBodyHandle {
  const physics = usePhysics2D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const _fixedRotation = options.fixedRotation ?? false;
  const _initX = options.initialPosition?.x ?? 0;
  const _initY = options.initialPosition?.y ?? 0;
  const _initAngle = options.initialAngle ?? 0;

  let _bodyHandle = physics.addRigidBody(entityId, 'kinematic', _initX, _initY);
  physics.setKinematicPositionWithAngle(entityId, _initX, _initY, _initAngle);
  let _active = true;
  let _vx = 0;
  let _vy = 0;
  let _omega = 0;

  onBeforeUpdate((dt) => {
    if (!_active || !Number.isFinite(dt) || dt <= 0) return;
    const pos = physics.getPosition(entityId);
    if (!pos) return;
    const newAngle = _fixedRotation ? pos.rotation : pos.rotation + _omega * dt;
    physics.setKinematicPositionWithAngle(entityId, pos.x + _vx * dt, pos.y + _vy * dt, newAngle);
  });

  return {
    get bodyId() {
      return _bodyHandle;
    },
    get active() {
      return _active;
    },
    get velocity() {
      return { x: _vx, y: _vy };
    },
    get angularVelocity() {
      return _omega;
    },

    moveTo(x, y, angle = 0) {
      if (!_active) return;
      physics.setKinematicPositionWithAngle(entityId, x, y, _fixedRotation ? 0 : angle);
    },

    setVelocity(vx, vy) {
      _vx = vx;
      _vy = vy;
    },

    setAngularVelocity(omega) {
      if (_fixedRotation) return;
      _omega = omega;
    },

    enable() {
      if (_active) return;
      _bodyHandle = physics.addRigidBody(entityId, 'kinematic', _initX, _initY);
      physics.setKinematicPositionWithAngle(entityId, _initX, _initY, _initAngle);
      _active = true;
    },

    disable() {
      if (!_active) return;
      physics.removeBody(entityId);
      _active = false;
    },
  };
}

/**
 * @file useKinematicBody() — registers a kinematic 3D physics body for the current actor.
 *
 * A kinematic body participates in collision detection and pushes dynamic bodies
 * out of its path, but is **never displaced by forces or gravity**. Its position
 * is driven entirely by {@link KinematicBodyHandle3D.setVelocity} +
 * `onBeforeUpdate` integration, or by explicit {@link KinematicBodyHandle3D.moveTo} calls.
 */
import { onBeforeUpdate } from '@gwenjs/core';
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import type {
  KinematicBodyOptions3D,
  KinematicBodyHandle3D,
  Physics3DVec3,
  Physics3DQuat,
} from '../types';
import { usePhysics3D } from '../composables';

/**
 * Registers the current actor's entity as a kinematic 3D physics body.
 *
 * Must be called inside a `defineActor()` factory function or any active
 * engine context (`defineSystem()`, `engine.run()`).
 *
 * @param options - Initial position, rotation, and rotation lock configuration.
 * @returns A {@link KinematicBodyHandle3D} for controlling position and velocity.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const VehicleActor = defineActor(VehiclePrefab, () => {
 *   const body = useKinematicBody({ fixedRotation: false })
 *   useBoxCollider({ w: 2, h: 1, d: 4 })
 *
 *   onUpdate(() => {
 *     body.setVelocity(input.x * SPEED, 0, input.z * SPEED)
 *     body.setAngularVelocity(0, input.steer * TURN_SPEED, 0)
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useKinematicBody(options: KinematicBodyOptions3D = {}): KinematicBodyHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId() as unknown as EntityId;
  const _fixedRotation = options.fixedRotation ?? false;

  const creationOptions = {
    kind: 'kinematic' as const,
    initialPosition: options.initialPosition,
    initialRotation: options.initialRotation,
  };

  let _handle = physics.createBody(entityId, creationOptions);
  let _active = true;
  let _vx = 0,
    _vy = 0,
    _vz = 0;
  let _wx = 0,
    _wy = 0,
    _wz = 0;

  onBeforeUpdate((dt: number) => {
    if (!_active || !Number.isFinite(dt) || dt <= 0) return;
    const state = physics.getBodyState(entityId);
    if (!state) return;

    const { position: p, rotation: r } = state;

    let rotation: Physics3DQuat;
    if (!_fixedRotation && (_wx !== 0 || _wy !== 0 || _wz !== 0)) {
      // First-order quaternion integration: dq = 0.5 * [wx,wy,wz,0] * q * dt
      const hdt = 0.5 * dt;
      const nqx = r.x + hdt * (_wx * r.w + _wy * r.z - _wz * r.y);
      const nqy = r.y + hdt * (-_wx * r.z + _wy * r.w + _wz * r.x);
      const nqz = r.z + hdt * (_wx * r.y - _wy * r.x + _wz * r.w);
      const nqw = r.w + hdt * (-_wx * r.x - _wy * r.y - _wz * r.z);
      const len = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
      if (len > 0) {
        rotation = { x: nqx / len, y: nqy / len, z: nqz / len, w: nqw / len };
      } else {
        rotation = r; // degenerate — preserve last valid orientation
      }
    } else {
      rotation = r;
    }

    physics.setKinematicPosition(
      entityId,
      { x: p.x + _vx * dt, y: p.y + _vy * dt, z: p.z + _vz * dt },
      rotation,
    );
  });

  return {
    get bodyId() {
      return _handle.bodyId;
    },
    get active() {
      return _active;
    },
    get velocity(): Physics3DVec3 {
      return { x: _vx, y: _vy, z: _vz };
    },
    get angularVelocity(): Physics3DVec3 {
      return { x: _wx, y: _wy, z: _wz };
    },

    moveTo(x: number, y: number, z: number, qx = 0, qy = 0, qz = 0, qw = 1): void {
      if (!_active) return;
      physics.setKinematicPosition(entityId, { x, y, z }, { x: qx, y: qy, z: qz, w: qw });
    },

    setVelocity(vx: number, vy: number, vz: number): void {
      _vx = vx;
      _vy = vy;
      _vz = vz;
    },

    setAngularVelocity(wx: number, wy: number, wz: number): void {
      if (_fixedRotation) return;
      _wx = wx;
      _wy = wy;
      _wz = wz;
    },

    enable(): void {
      if (_active) return;
      _handle = physics.createBody(entityId, creationOptions);
      _active = true;
    },

    disable(): void {
      if (!_active) return;
      physics.removeBody(entityId);
      _active = false;
    },
  };
}

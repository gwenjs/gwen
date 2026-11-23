/**
 * @file useDynamicBody() — registers a fully simulated 3D physics body for the current actor.
 */
import { onBeforeUpdate } from "@gwenjs/core/system";
import { _getActorEntityId } from "@gwenjs/core/internal";
import type { Vec3 } from "@gwenjs/math";
import type { DynamicBodyOptions3D, DynamicBodyHandle3D, Physics3DBodyOptions } from "../types";
import { usePhysics3D } from "../composables";

/** Zero vector returned when body is inactive. Reused to avoid allocation. */
const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** Fresh sums for one body. Two actors must not share this object. */
function newForceAccum(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

/**
 * Registers the current actor's entity as a fully simulated 3D physics body.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @param options - Mass, damping, gravity scale, CCD, initial state, and layer config.
 * @returns A {@link DynamicBodyHandle3D} for applying forces, reading velocity, and toggling
 *   the body at runtime.
 * @throws {GwenPluginNotFoundError} If `@gwenjs/physics3d` is not registered.
 *
 * @example
 * ```typescript
 * const BallActor = defineActor(BallPrefab, () => {
 *   const body = useDynamicBody({ mass: 2, ccdEnabled: true })
 *   useSphereCollider({ radius: 0.5 })
 *   // jump on spawn
 *   body.applyImpulse(0, 10, 0)
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useDynamicBody(options: DynamicBodyOptions3D = {}): DynamicBodyHandle3D {
  const physics = usePhysics3D();
  const entityId = _getActorEntityId("useDynamicBody");

  const creationOptions: Physics3DBodyOptions = {
    kind: "dynamic",
    ...(options.mass !== undefined ? { mass: options.mass } : {}),
    ...(options.gravityScale !== undefined ? { gravityScale: options.gravityScale } : {}),
    ...(options.linearDamping !== undefined ? { linearDamping: options.linearDamping } : {}),
    ...(options.angularDamping !== undefined ? { angularDamping: options.angularDamping } : {}),
    ...(options.ccdEnabled !== undefined ? { ccdEnabled: options.ccdEnabled } : {}),
    ...(options.initialPosition !== undefined ? { initialPosition: options.initialPosition } : {}),
    ...(options.initialRotation !== undefined ? { initialRotation: options.initialRotation } : {}),
    ...(options.initialLinearVelocity !== undefined
      ? { initialLinearVelocity: options.initialLinearVelocity }
      : {}),
    ...(options.initialAngularVelocity !== undefined
      ? { initialAngularVelocity: options.initialAngularVelocity }
      : {}),
    ...(options.fixedRotation !== undefined ? { fixedRotation: options.fixedRotation } : {}),
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
  };

  let _handle = physics.createBody(entityId, creationOptions);
  let _active = true;
  const acc = newForceAccum();
  const impulse = { x: 0, y: 0, z: 0 };

  onBeforeUpdate((dt: number) => {
    const usable = _active && Number.isFinite(dt) && dt > 0;
    if (usable && (acc.x !== 0 || acc.y !== 0 || acc.z !== 0)) {
      impulse.x = acc.x * dt;
      impulse.y = acc.y * dt;
      impulse.z = acc.z * dt;
      physics.applyImpulse(entityId, impulse);
    }
    acc.x = 0;
    acc.y = 0;
    acc.z = 0;
  });

  return {
    get bodyId() {
      return _handle.bodyId;
    },
    get active() {
      return _active;
    },

    enable() {
      if (_active) return;
      _handle = physics.createBody(entityId, creationOptions);
      _active = true;
    },

    disable() {
      if (!_active) return;
      physics.removeBody(entityId);
      _active = false;
    },

    /**
     * Apply a continuous linear force to the body in newtons.
     *
     * Accumulated and applied as one impulse each frame, scaled by dt.
     * Call it every frame to sustain the force. No-op when the body is inactive.
     *
     * @param fx - Force X component in N.
     * @param fy - Force Y component in N.
     * @param fz - Force Z component in N.
     */
    applyForce(fx: number, fy: number, fz: number): void {
      if (!_active) return;
      acc.x += fx;
      acc.y += fy;
      acc.z += fz;
    },

    /**
     * Apply an instantaneous linear impulse to the body in N·s.
     *
     * @param ix - Impulse X component in N·s.
     * @param iy - Impulse Y component in N·s.
     * @param iz - Impulse Z component in N·s.
     */
    applyImpulse(ix: number, iy: number, iz: number): void {
      if (!_active) return;
      physics.applyImpulse(entityId, { x: ix, y: iy, z: iz });
    },

    /**
     * Apply a continuous torque to the body in N·m.
     *
     * @param tx - Torque X component in N·m.
     * @param ty - Torque Y component in N·m.
     * @param tz - Torque Z component in N·m.
     */
    applyTorque(tx: number, ty: number, tz: number): void {
      if (!_active) return;
      physics.applyTorque(entityId, { x: tx, y: ty, z: tz });
    },

    /**
     * Set the linear velocity of the body directly in m/s.
     *
     * @param vx - Velocity X component in m/s.
     * @param vy - Velocity Y component in m/s.
     * @param vz - Velocity Z component in m/s.
     */
    setVelocity(vx: number, vy: number, vz: number): void {
      if (!_active) return;
      physics.setLinearVelocity(entityId, { x: vx, y: vy, z: vz });
    },

    /**
     * Current linear velocity in m/s.
     * Returns a zero vector when the body is inactive.
     */
    get velocity(): Vec3 {
      return physics.getLinearVelocity(entityId) ?? ZERO_VEC3;
    },

    /**
     * Current angular velocity in rad/s.
     * Returns a zero vector when the body is inactive.
     */
    get angularVelocity(): Vec3 {
      return physics.getAngularVelocity(entityId) ?? ZERO_VEC3;
    },
  };
}

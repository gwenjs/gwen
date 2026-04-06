/**
 * @file useJoint() — creates a physics joint between two bodies and returns a control handle.
 */
import { usePhysics3D } from '../composables';
import type {
  JointHandle3D,
  FixedJointOpts,
  RevoluteJointOpts,
  PrismaticJointOpts,
  BallJointOpts,
  SpringJointOpts,
} from '../types';

/**
 * Discriminated union of all joint option types.
 *
 * The `type` field selects which joint factory is used:
 * - `'fixed'`     — rigid weld, no relative movement ({@link FixedJointOpts})
 * - `'revolute'`  — hinge rotation around one axis ({@link RevoluteJointOpts})
 * - `'prismatic'` — linear slide along one axis ({@link PrismaticJointOpts})
 * - `'ball'`      — spherical, unrestricted rotation ({@link BallJointOpts})
 * - `'spring'`    — elastic connection with rest length ({@link SpringJointOpts})
 */
export type UseJointOpts =
  | ({ type: 'fixed' } & FixedJointOpts)
  | ({ type: 'revolute' } & RevoluteJointOpts)
  | ({ type: 'prismatic' } & PrismaticJointOpts)
  | ({ type: 'ball' } & BallJointOpts)
  | ({ type: 'spring' } & SpringJointOpts);

/**
 * Handle returned by {@link useJoint}.
 *
 * Provides motor control, enable/disable toggling, and cleanup via `dispose()`.
 */
export interface UseJointHandle {
  /** The numeric joint identifier. Pass to raw `Physics3DAPI` methods if needed. */
  readonly id: JointHandle3D;
  /**
   * Sets a motor target velocity on a revolute or prismatic joint.
   *
   * @param velocity - Desired angular (rad/s) or linear (m/s) velocity.
   * @param maxForce - Maximum torque or force the motor may apply.
   */
  setMotorVelocity(velocity: number, maxForce: number): void;
  /**
   * Sets a motor target position on a revolute or prismatic joint.
   *
   * @param target   - Target angle (radians) or translation (metres).
   * @param stiffness - Spring stiffness driving toward the target.
   * @param damping   - Damping coefficient opposing motion.
   */
  setMotorPosition(target: number, stiffness: number, damping: number): void;
  /**
   * Enables or disables the joint constraint.
   *
   * Disabling a joint keeps the bodies in the simulation but removes the
   * constraint forces between them.
   *
   * @param enabled - `true` to enable the joint, `false` to disable it.
   */
  setEnabled(enabled: boolean): void;
  /**
   * Removes the joint from the simulation and frees its resources.
   *
   * The joint handle becomes invalid after this call.
   */
  dispose(): void;
}

/**
 * Creates a physics joint between two simulation bodies and returns a
 * control handle.
 *
 * The joint is created immediately and persists until `handle.dispose()` is
 * called. All motor-control and enable/disable helpers are available on the
 * returned handle.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `engine.run()`, or a plugin lifecycle hook).
 *
 * @param opts - Joint type (discriminated by `type`) plus joint-specific
 *   options such as anchors, axis, limits, and spring parameters.
 * @returns A {@link UseJointHandle} for motor control, toggling, and removal.
 * @throws {GwenPluginNotFoundError} If `physics3dPlugin()` is not registered.
 *
 * @example
 * ```typescript
 * // Revolute joint acting as a door hinge
 * const hinge = useJoint({
 *   type: 'revolute',
 *   bodyA: doorFrameId,
 *   bodyB: doorPanelId,
 *   axis: { x: 0, y: 1, z: 0 },
 *   limits: [-Math.PI / 2, 0],
 * })
 *
 * // Open the door by setting motor velocity
 * hinge.setMotorVelocity(1.5, 50)
 *
 * // Clean up on scene unload
 * onDestroy(() => hinge.dispose())
 * ```
 *
 * @since 1.0.0
 */
export function useJoint(opts: UseJointOpts): UseJointHandle {
  const physics = usePhysics3D();

  let jointId: JointHandle3D;

  switch (opts.type) {
    case 'fixed':
      jointId = physics.addFixedJoint(opts);
      break;
    case 'revolute':
      jointId = physics.addRevoluteJoint(opts);
      break;
    case 'prismatic':
      jointId = physics.addPrismaticJoint(opts);
      break;
    case 'ball':
      jointId = physics.addBallJoint(opts);
      break;
    case 'spring':
      jointId = physics.addSpringJoint(opts);
      break;
  }

  return {
    get id() {
      return jointId;
    },
    setMotorVelocity(velocity: number, maxForce: number) {
      physics.setJointMotorVelocity(jointId, velocity, maxForce);
    },
    setMotorPosition(target: number, stiffness: number, damping: number) {
      physics.setJointMotorPosition(jointId, target, stiffness, damping);
    },
    setEnabled(enabled: boolean) {
      physics.setJointEnabled(jointId, enabled);
    },
    dispose() {
      physics.removeJoint(jointId);
    },
  };
}

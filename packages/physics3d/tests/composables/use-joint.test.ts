/**
 * Tests for useJoint() composable.
 *
 * Verifies that useJoint delegates to the correct Physics3D service factory
 * based on the discriminated `type` field, and that the control handle
 * delegates motor, enable, and dispose calls correctly.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockPhysics3D = {
  addFixedJoint: vi.fn().mockReturnValue(1),
  addRevoluteJoint: vi.fn().mockReturnValue(2),
  addPrismaticJoint: vi.fn().mockReturnValue(3),
  addBallJoint: vi.fn().mockReturnValue(4),
  addSpringJoint: vi.fn().mockReturnValue(5),
  removeJoint: vi.fn(),
  setJointMotorVelocity: vi.fn(),
  setJointMotorPosition: vi.fn(),
  setJointEnabled: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useJoint } from '../../src/composables/use-joint.js';

/** Shared body ids for all tests. */
const BODY_A = 1n;
const BODY_B = 2n;

describe('useJoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.addFixedJoint.mockReturnValue(1);
    mockPhysics3D.addRevoluteJoint.mockReturnValue(2);
    mockPhysics3D.addPrismaticJoint.mockReturnValue(3);
    mockPhysics3D.addBallJoint.mockReturnValue(4);
    mockPhysics3D.addSpringJoint.mockReturnValue(5);
  });

  // ─── Joint factory dispatch ────────────────────────────────────────────────

  it('type:fixed calls addFixedJoint with the opts (minus the type discriminant)', () => {
    useJoint({ type: 'fixed', bodyA: BODY_A, bodyB: BODY_B });
    expect(mockPhysics3D.addFixedJoint).toHaveBeenCalledWith(
      expect.objectContaining({ bodyA: BODY_A, bodyB: BODY_B }),
    );
    expect(mockPhysics3D.addRevoluteJoint).not.toHaveBeenCalled();
  });

  it('type:revolute calls addRevoluteJoint', () => {
    useJoint({
      type: 'revolute',
      bodyA: BODY_A,
      bodyB: BODY_B,
      axis: { x: 0, y: 1, z: 0 },
    });
    expect(mockPhysics3D.addRevoluteJoint).toHaveBeenCalledTimes(1);
    expect(mockPhysics3D.addFixedJoint).not.toHaveBeenCalled();
  });

  it('type:prismatic calls addPrismaticJoint', () => {
    useJoint({
      type: 'prismatic',
      bodyA: BODY_A,
      bodyB: BODY_B,
      axis: { x: 0, y: 0, z: 1 },
    });
    expect(mockPhysics3D.addPrismaticJoint).toHaveBeenCalledTimes(1);
  });

  it('type:ball calls addBallJoint', () => {
    useJoint({ type: 'ball', bodyA: BODY_A, bodyB: BODY_B });
    expect(mockPhysics3D.addBallJoint).toHaveBeenCalledTimes(1);
  });

  it('type:spring calls addSpringJoint', () => {
    useJoint({
      type: 'spring',
      bodyA: BODY_A,
      bodyB: BODY_B,
      restLength: 1,
      stiffness: 100,
      damping: 5,
    });
    expect(mockPhysics3D.addSpringJoint).toHaveBeenCalledTimes(1);
  });

  // ─── id getter ────────────────────────────────────────────────────────────

  it('handle.id reflects the value returned by the factory', () => {
    const handle = useJoint({ type: 'fixed', bodyA: BODY_A, bodyB: BODY_B });
    expect(handle.id).toBe(1);
  });

  it('handle.id for revolute joint is 2', () => {
    const handle = useJoint({ type: 'revolute', bodyA: BODY_A, bodyB: BODY_B });
    expect(handle.id).toBe(2);
  });

  // ─── Motor control ────────────────────────────────────────────────────────

  it('handle.setMotorVelocity delegates to setJointMotorVelocity with correct jointId', () => {
    const handle = useJoint({ type: 'revolute', bodyA: BODY_A, bodyB: BODY_B });
    handle.setMotorVelocity(1.5, 50);
    expect(mockPhysics3D.setJointMotorVelocity).toHaveBeenCalledWith(2, 1.5, 50);
  });

  it('handle.setMotorPosition delegates to setJointMotorPosition with correct jointId', () => {
    const handle = useJoint({ type: 'prismatic', bodyA: BODY_A, bodyB: BODY_B });
    handle.setMotorPosition(0.5, 200, 10);
    expect(mockPhysics3D.setJointMotorPosition).toHaveBeenCalledWith(3, 0.5, 200, 10);
  });

  it('handle.setEnabled(true) delegates to setJointEnabled with correct jointId', () => {
    const handle = useJoint({ type: 'fixed', bodyA: BODY_A, bodyB: BODY_B });
    handle.setEnabled(true);
    expect(mockPhysics3D.setJointEnabled).toHaveBeenCalledWith(1, true);
  });

  it('handle.setEnabled(false) delegates to setJointEnabled with false', () => {
    const handle = useJoint({ type: 'ball', bodyA: BODY_A, bodyB: BODY_B });
    handle.setEnabled(false);
    expect(mockPhysics3D.setJointEnabled).toHaveBeenCalledWith(4, false);
  });

  // ─── Dispose ──────────────────────────────────────────────────────────────

  it('handle.dispose() calls removeJoint with the joint id', () => {
    const handle = useJoint({ type: 'fixed', bodyA: BODY_A, bodyB: BODY_B });
    handle.dispose();
    expect(mockPhysics3D.removeJoint).toHaveBeenCalledWith(1);
  });

  it('handle.dispose() calls removeJoint exactly once', () => {
    const handle = useJoint({
      type: 'spring',
      bodyA: BODY_A,
      bodyB: BODY_B,
      restLength: 2,
      stiffness: 50,
      damping: 2,
    });
    handle.dispose();
    expect(mockPhysics3D.removeJoint).toHaveBeenCalledTimes(1);
  });

  it('each joint type disposes with its own id', () => {
    const fixed = useJoint({ type: 'fixed', bodyA: BODY_A, bodyB: BODY_B });
    const revolute = useJoint({ type: 'revolute', bodyA: BODY_A, bodyB: BODY_B });
    fixed.dispose();
    revolute.dispose();
    expect(mockPhysics3D.removeJoint).toHaveBeenNthCalledWith(1, 1);
    expect(mockPhysics3D.removeJoint).toHaveBeenNthCalledWith(2, 2);
  });
});

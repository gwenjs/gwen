/**
 * @file useKinematicBody() composable tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

let _beforeUpdateCb: ((dt: number) => void) | null = null;

vi.mock('@gwenjs/core', () => ({
  onBeforeUpdate: vi.fn((fn: (dt: number) => void) => {
    _beforeUpdateCb = fn;
  }),
}));

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 10n),
}));

const mockPhysics = {
  addRigidBody: vi.fn(() => 77),
  removeBody: vi.fn(),
  getPosition: vi.fn(() => ({ x: 0, y: 0, rotation: 0 })),
  setKinematicPositionWithAngle: vi.fn(() => true),
  setKinematicPosition: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

import { useKinematicBody } from '../../src/composables/use-kinematic-body.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useKinematicBody (physics2d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _beforeUpdateCb = null;
    mockPhysics.addRigidBody.mockReturnValue(77);
    mockPhysics.getPosition.mockReturnValue({ x: 0, y: 0, rotation: 0 });
    mockPhysics.setKinematicPositionWithAngle.mockReturnValue(true);
  });

  it('calls addRigidBody with type "kinematic"', () => {
    useKinematicBody();
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(10n, 'kinematic', 0, 0);
  });

  it('bodyId equals the handle returned by addRigidBody', () => {
    const h = useKinematicBody();
    expect(h.bodyId).toBe(77);
  });

  it('active is true initially', () => {
    expect(useKinematicBody().active).toBe(true);
  });

  it('velocity getter returns {x:0, y:0} initially', () => {
    expect(useKinematicBody().velocity).toEqual({ x: 0, y: 0 });
  });

  it('angularVelocity getter returns 0 initially', () => {
    expect(useKinematicBody().angularVelocity).toBe(0);
  });

  it('setVelocity stores values returned by velocity getter', () => {
    const h = useKinematicBody();
    h.setVelocity(3, 4);
    expect(h.velocity).toEqual({ x: 3, y: 4 });
  });

  it('setAngularVelocity stores value returned by angularVelocity getter', () => {
    const h = useKinematicBody();
    h.setAngularVelocity(1.5);
    expect(h.angularVelocity).toBe(1.5);
  });

  it('setAngularVelocity is a no-op when fixedRotation: true', () => {
    const h = useKinematicBody({ fixedRotation: true });
    h.setAngularVelocity(99);
    expect(h.angularVelocity).toBe(0);
  });

  it('onBeforeUpdate integrates position via setKinematicPositionWithAngle', () => {
    const h = useKinematicBody();
    h.setVelocity(2, 3);
    mockPhysics.getPosition.mockReturnValue({ x: 1, y: 1, rotation: 0 });
    expect(_beforeUpdateCb).not.toBeNull();
    _beforeUpdateCb!(0.5); // dt = 0.5s
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(
      10n,
      2,
      2.5,
      0, // x=1+2*0.5=2, y=1+3*0.5=2.5, angle=0
    );
  });

  it('onBeforeUpdate integrates angle when setAngularVelocity was called', () => {
    const h = useKinematicBody();
    h.setAngularVelocity(2);
    mockPhysics.getPosition.mockReturnValue({ x: 0, y: 0, rotation: 1 });
    _beforeUpdateCb!(0.5);
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(
      10n,
      0,
      0,
      2, // angle = 1 + 2*0.5 = 2
    );
  });

  it('onBeforeUpdate is a no-op when body is inactive', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1);
    h.disable();
    mockPhysics.setKinematicPositionWithAngle.mockClear();
    _beforeUpdateCb!(0.1);
    expect(mockPhysics.setKinematicPositionWithAngle).not.toHaveBeenCalled();
  });

  it('onBeforeUpdate is a no-op when dt <= 0', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1);
    mockPhysics.setKinematicPositionWithAngle.mockClear();
    _beforeUpdateCb!(0);
    expect(mockPhysics.setKinematicPositionWithAngle).not.toHaveBeenCalled();
  });

  it('moveTo calls setKinematicPositionWithAngle immediately', () => {
    const h = useKinematicBody();
    h.moveTo(5, 6, 1.2);
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(10n, 5, 6, 1.2);
  });

  it('moveTo defaults angle to 0 when omitted', () => {
    const h = useKinematicBody();
    h.moveTo(1, 2);
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(10n, 1, 2, 0);
  });

  it('moveTo is a no-op when inactive', () => {
    const h = useKinematicBody();
    h.disable();
    mockPhysics.setKinematicPositionWithAngle.mockClear();
    h.moveTo(9, 9);
    expect(mockPhysics.setKinematicPositionWithAngle).not.toHaveBeenCalled();
  });

  it('disable() calls removeBody and sets active to false', () => {
    const h = useKinematicBody();
    h.disable();
    expect(mockPhysics.removeBody).toHaveBeenCalled();
    expect(h.active).toBe(false);
  });

  it('enable() after disable recreates the body', () => {
    const h = useKinematicBody({ initialPosition: { x: 3, y: 4 } });
    h.disable();
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(77);
    h.enable();
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(10n, 'kinematic', 3, 4);
    expect(h.active).toBe(true);
  });

  it('disable() twice is a no-op on the second call', () => {
    const h = useKinematicBody();
    h.disable();
    vi.clearAllMocks();
    h.disable();
    expect(mockPhysics.removeBody).not.toHaveBeenCalled();
  });

  it('enable() twice is a no-op on the second call', () => {
    const h = useKinematicBody();
    vi.clearAllMocks();
    h.enable();
    expect(mockPhysics.addRigidBody).not.toHaveBeenCalled();
  });

  it('passes initialPosition to addRigidBody', () => {
    useKinematicBody({ initialPosition: { x: 3, y: 4 } });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(10n, 'kinematic', 3, 4);
  });

  it('passes initialAngle to setKinematicPositionWithAngle', () => {
    useKinematicBody({ initialAngle: Math.PI });
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(10n, 0, 0, Math.PI);
  });

  it('moveTo ignores angle when fixedRotation: true', () => {
    const h = useKinematicBody({ fixedRotation: true });
    vi.clearAllMocks();
    h.moveTo(5, 6, 1.2);
    expect(mockPhysics.setKinematicPositionWithAngle).toHaveBeenCalledWith(10n, 5, 6, 0);
  });

  it('onBeforeUpdate is a no-op when dt is NaN', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1);
    mockPhysics.setKinematicPositionWithAngle.mockClear();
    _beforeUpdateCb!(NaN);
    expect(mockPhysics.setKinematicPositionWithAngle).not.toHaveBeenCalled();
  });
});

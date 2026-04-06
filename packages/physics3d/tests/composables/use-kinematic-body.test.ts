import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Physics3DBodyHandle } from '../../src/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let _beforeUpdateCb: ((dt: number) => void) | null = null;

vi.mock('@gwenjs/core', () => ({
  onBeforeUpdate: vi.fn((fn: (dt: number) => void) => {
    _beforeUpdateCb = fn;
  }),
}));

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle: Physics3DBodyHandle = {
  bodyId: 55,
  entityId: 0,
  kind: 'kinematic',
  mass: 0,
  linearDamping: 0,
  angularDamping: 0,
};

const mockPhysics3D = {
  createBody: vi.fn(() => mockBodyHandle),
  removeBody: vi.fn(() => true),
  getBodyState: vi.fn(() => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
  })),
  setKinematicPosition: vi.fn(() => true),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useKinematicBody } from '../../src/composables/use-kinematic-body.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useKinematicBody (physics3d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _beforeUpdateCb = null;
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    mockPhysics3D.getBodyState.mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
  });

  it('calls createBody with kind: "kinematic"', () => {
    useKinematicBody();
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ kind: 'kinematic' }),
    );
  });

  it('bodyId equals mockBodyHandle.bodyId (55)', () => {
    expect(useKinematicBody().bodyId).toBe(55);
  });

  it('active is true initially', () => {
    expect(useKinematicBody().active).toBe(true);
  });

  it('velocity getter returns {x:0, y:0, z:0} initially', () => {
    expect(useKinematicBody().velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('angularVelocity getter returns {x:0, y:0, z:0} initially', () => {
    expect(useKinematicBody().angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('setVelocity stores values returned by velocity getter', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 2, 3);
    expect(h.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('setAngularVelocity stores values returned by angularVelocity getter', () => {
    const h = useKinematicBody();
    h.setAngularVelocity(0.1, 0.2, 0.3);
    expect(h.angularVelocity).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('setAngularVelocity is a no-op when fixedRotation: true', () => {
    const h = useKinematicBody({ fixedRotation: true });
    h.setAngularVelocity(1, 2, 3);
    expect(h.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('onBeforeUpdate integrates position via setKinematicPosition', () => {
    const h = useKinematicBody();
    h.setVelocity(2, 0, 0);
    mockPhysics3D.getBodyState.mockReturnValue({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    _beforeUpdateCb!(0.5);
    expect(mockPhysics3D.setKinematicPosition).toHaveBeenCalledWith(
      1n,
      { x: 2, y: 0, z: 0 }, // x = 1 + 2 * 0.5 = 2
      expect.objectContaining({ w: 1 }),
    );
  });

  it('onBeforeUpdate is a no-op when body is inactive', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1, 1);
    h.disable();
    _beforeUpdateCb!(0.1);
    expect(mockPhysics3D.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('onBeforeUpdate is a no-op when dt <= 0', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1, 1);
    _beforeUpdateCb!(0);
    expect(mockPhysics3D.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('onBeforeUpdate is a no-op when dt is NaN', () => {
    const h = useKinematicBody();
    h.setVelocity(1, 1, 1);
    _beforeUpdateCb!(NaN);
    expect(mockPhysics3D.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('onBeforeUpdate integrates quaternion rotation when setAngularVelocity is called', () => {
    const h = useKinematicBody();
    h.setAngularVelocity(1, 0, 0); // 1 rad/s around X axis
    mockPhysics3D.getBodyState.mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, // identity
    });
    vi.clearAllMocks();
    _beforeUpdateCb!(1.0);

    const call = mockPhysics3D.setKinematicPosition.mock.calls[0];
    const q = call[2]; // rotation arg
    // First-order integration: x should be > 0 after rotating around X
    expect(q.x).toBeGreaterThan(0);
    expect(q.y).toBeCloseTo(0, 5);
    expect(q.z).toBeCloseTo(0, 5);
    // Quaternion must remain unit length
    const len = Math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2);
    expect(len).toBeCloseTo(1, 5);
  });

  it('onBeforeUpdate preserves rotation when fixedRotation: true', () => {
    const h = useKinematicBody({ fixedRotation: true });
    // setAngularVelocity is a no-op for fixedRotation bodies
    h.setAngularVelocity(1, 1, 1);
    const identityRot = { x: 0, y: 0, z: 0, w: 1 };
    mockPhysics3D.getBodyState.mockReturnValue({
      position: { x: 0, y: 0, z: 0 },
      rotation: identityRot,
    });
    vi.clearAllMocks();
    _beforeUpdateCb!(1.0);

    const call = mockPhysics3D.setKinematicPosition.mock.calls[0];
    expect(call[2]).toEqual(identityRot); // rotation must not change
  });

  it('moveTo calls setKinematicPosition with provided position and quaternion', () => {
    const h = useKinematicBody();
    h.moveTo(3, 4, 5, 0, 0, 0.707, 0.707);
    expect(mockPhysics3D.setKinematicPosition).toHaveBeenCalledWith(
      1n,
      { x: 3, y: 4, z: 5 },
      { x: 0, y: 0, z: 0.707, w: 0.707 },
    );
  });

  it('moveTo defaults quaternion to identity when omitted', () => {
    const h = useKinematicBody();
    h.moveTo(1, 2, 3);
    expect(mockPhysics3D.setKinematicPosition).toHaveBeenCalledWith(
      1n,
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
  });

  it('moveTo is a no-op when body is inactive', () => {
    const h = useKinematicBody();
    h.disable();
    h.moveTo(9, 9, 9);
    expect(mockPhysics3D.setKinematicPosition).not.toHaveBeenCalled();
  });

  it('disable() calls removeBody and sets active to false', () => {
    const h = useKinematicBody();
    h.disable();
    expect(mockPhysics3D.removeBody).toHaveBeenCalledWith(1n);
    expect(h.active).toBe(false);
  });

  it('enable() after disable recreates the body and sets active to true', () => {
    const h = useKinematicBody();
    h.disable();
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    h.enable();
    expect(mockPhysics3D.createBody).toHaveBeenCalled();
    expect(h.active).toBe(true);
  });

  it('disable() twice is a no-op on the second call', () => {
    const h = useKinematicBody();
    h.disable();
    vi.clearAllMocks();
    h.disable();
    expect(mockPhysics3D.removeBody).not.toHaveBeenCalled();
  });

  it('enable() twice is a no-op on the second call', () => {
    const h = useKinematicBody();
    vi.clearAllMocks();
    h.enable();
    expect(mockPhysics3D.createBody).not.toHaveBeenCalled();
  });

  it('passes initialPosition and initialRotation to createBody', () => {
    useKinematicBody({
      initialPosition: { x: 1, y: 2, z: 3 },
      initialRotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        kind: 'kinematic',
        initialPosition: { x: 1, y: 2, z: 3 },
        initialRotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    );
  });
});

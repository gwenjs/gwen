import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Physics3DBodyHandle } from '../../src/types.js';

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle: Physics3DBodyHandle = {
  bodyId: 42,
  entityId: 0,
  kind: 'dynamic',
  mass: 1,
  linearDamping: 0,
  angularDamping: 0,
};

const mockPhysics3D = {
  createBody: vi.fn(() => mockBodyHandle),
  removeBody: vi.fn(() => true),
  applyImpulse: vi.fn(() => true),
  applyAngularImpulse: vi.fn(() => true),
  applyTorque: vi.fn(() => true),
  setLinearVelocity: vi.fn(() => true),
  getLinearVelocity: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
  getAngularVelocity: vi.fn(() => ({ x: 0.1, y: 0.2, z: 0.3 })),
  addCollider: vi.fn(() => true),
  removeCollider: vi.fn(() => true),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useDynamicBody } from '../../src/composables/use-dynamic-body.js';

describe('useDynamicBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    mockPhysics3D.removeBody.mockReturnValue(true);
    mockPhysics3D.getLinearVelocity.mockReturnValue({ x: 1, y: 2, z: 3 });
    mockPhysics3D.getAngularVelocity.mockReturnValue({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('calls createBody with kind: dynamic', () => {
    useDynamicBody();
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ kind: 'dynamic' }),
    );
  });

  it('handle.bodyId equals mockBodyHandle.bodyId (42)', () => {
    const handle = useDynamicBody();
    expect(handle.bodyId).toBe(42);
  });

  it('handle.active is true initially', () => {
    const handle = useDynamicBody();
    expect(handle.active).toBe(true);
  });

  it('applyForce(1,2,3) calls applyImpulse with {x:1, y:2, z:3}', () => {
    const handle = useDynamicBody();
    handle.applyForce(1, 2, 3);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, { x: 1, y: 2, z: 3 });
  });

  it('applyImpulse(4,5,6) calls applyImpulse with {x:4, y:5, z:6}', () => {
    const handle = useDynamicBody();
    handle.applyImpulse(4, 5, 6);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, { x: 4, y: 5, z: 6 });
  });

  it('applyTorque(7,8,9) calls applyTorque with {x:7, y:8, z:9}', () => {
    const handle = useDynamicBody();
    handle.applyTorque(7, 8, 9);
    expect(mockPhysics3D.applyTorque).toHaveBeenCalledWith(1n, { x: 7, y: 8, z: 9 });
  });

  it('setVelocity(1,2,3) calls setLinearVelocity with {x:1, y:2, z:3}', () => {
    const handle = useDynamicBody();
    handle.setVelocity(1, 2, 3);
    expect(mockPhysics3D.setLinearVelocity).toHaveBeenCalledWith(1n, { x: 1, y: 2, z: 3 });
  });

  it('velocity getter returns {x:1, y:2, z:3} from mock', () => {
    const handle = useDynamicBody();
    expect(handle.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('angularVelocity getter returns {x:0.1, y:0.2, z:0.3} from mock', () => {
    const handle = useDynamicBody();
    expect(handle.angularVelocity).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it('velocity returns zero vector when body is inactive', () => {
    const handle = useDynamicBody();
    handle.disable();
    mockPhysics3D.getLinearVelocity.mockReturnValue(undefined);
    expect(handle.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('angularVelocity returns zero vector when getAngularVelocity returns undefined', () => {
    const handle = useDynamicBody();
    mockPhysics3D.getAngularVelocity.mockReturnValue(undefined);
    expect(handle.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('disable() calls removeBody and sets active to false', () => {
    const handle = useDynamicBody();
    handle.disable();
    expect(mockPhysics3D.removeBody).toHaveBeenCalledWith(1n);
    expect(handle.active).toBe(false);
  });

  it('enable() after disable calls createBody again and sets active to true', () => {
    const handle = useDynamicBody();
    handle.disable();
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    handle.enable();
    expect(mockPhysics3D.createBody).toHaveBeenCalled();
    expect(handle.active).toBe(true);
  });

  it('enable() when already enabled is a no-op', () => {
    const handle = useDynamicBody();
    vi.clearAllMocks();
    handle.enable();
    expect(mockPhysics3D.createBody).not.toHaveBeenCalled();
  });

  it('disable() when already disabled is a no-op', () => {
    const handle = useDynamicBody();
    handle.disable();
    vi.clearAllMocks();
    handle.disable();
    expect(mockPhysics3D.removeBody).not.toHaveBeenCalled();
  });

  it('applyForce is a no-op when body is inactive', () => {
    const handle = useDynamicBody();
    handle.disable();
    vi.clearAllMocks();
    handle.applyForce(1, 2, 3);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });

  it('passes options to createBody (mass, gravityScale, etc.)', () => {
    useDynamicBody({ mass: 5, gravityScale: 0.5, ccdEnabled: true });
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        kind: 'dynamic',
        mass: 5,
        gravityScale: 0.5,
        ccdEnabled: true,
      }),
    );
  });
});

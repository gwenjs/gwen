import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Physics3DBodyHandle } from '../../src/types.js';

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle: Physics3DBodyHandle = {
  bodyId: 99,
  entityId: 0,
  kind: 'fixed',
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

import { useStaticBody } from '../../src/composables/use-static-body.js';

describe('useStaticBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockBodyHandle reference after clearAllMocks
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    mockPhysics3D.removeBody.mockReturnValue(true);
  });

  it('calls createBody with kind: fixed', () => {
    useStaticBody();
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(1n, { kind: 'fixed' });
  });

  it('handle.bodyId equals mockBodyHandle.bodyId (99)', () => {
    const handle = useStaticBody();
    expect(handle.bodyId).toBe(99);
  });

  it('handle.active is true initially', () => {
    const handle = useStaticBody();
    expect(handle.active).toBe(true);
  });

  it('handle.disable() calls removeBody and sets active to false', () => {
    const handle = useStaticBody();
    handle.disable();
    expect(mockPhysics3D.removeBody).toHaveBeenCalledWith(1n);
    expect(handle.active).toBe(false);
  });

  it('handle.enable() after disable calls createBody again and sets active to true', () => {
    const handle = useStaticBody();
    handle.disable();
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    handle.enable();
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(1n, { kind: 'fixed' });
    expect(handle.active).toBe(true);
  });

  it('handle.enable() when already enabled is a no-op', () => {
    const handle = useStaticBody();
    vi.clearAllMocks();
    handle.enable();
    expect(mockPhysics3D.createBody).not.toHaveBeenCalled();
  });

  it('handle.disable() when already disabled is a no-op', () => {
    const handle = useStaticBody();
    handle.disable();
    vi.clearAllMocks();
    handle.disable();
    expect(mockPhysics3D.removeBody).not.toHaveBeenCalled();
  });
});

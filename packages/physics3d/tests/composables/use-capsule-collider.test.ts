import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Physics3DBodyHandle } from '../../src/types.js';

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

vi.mock('../../src/composables/collider-id.js', () => ({
  nextColliderId: vi.fn(() => 1),
}));

const mockBodyHandle: Physics3DBodyHandle = {
  bodyId: 1,
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

import { useCapsuleCollider } from '../../src/composables/use-capsule-collider.js';

describe('useCapsuleCollider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.addCollider.mockReturnValue(true);
    mockPhysics3D.removeCollider.mockReturnValue(true);
  });

  it('calls addCollider with shape: { type: capsule, radius: 0.5, halfHeight: 1 }', () => {
    useCapsuleCollider({ radius: 0.5, height: 2 });
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        shape: { type: 'capsule', radius: 0.5, halfHeight: 1 },
      }),
    );
  });

  it('halfHeight = height / 2', () => {
    useCapsuleCollider({ radius: 0.3, height: 1.8 });
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        shape: { type: 'capsule', radius: 0.3, halfHeight: 0.9 },
      }),
    );
  });

  it('handle.colliderId is a number', () => {
    const handle = useCapsuleCollider({ radius: 0.5, height: 2 });
    expect(typeof handle.colliderId).toBe('number');
  });

  it('handle.remove() calls removeCollider with the correct colliderId', () => {
    const handle = useCapsuleCollider({ radius: 0.5, height: 2 });
    const cid = handle.colliderId;
    handle.remove();
    expect(mockPhysics3D.removeCollider).toHaveBeenCalledWith(1n, cid);
  });

  it('passes isSensor and material to addCollider', () => {
    useCapsuleCollider({ radius: 0.5, height: 2, isSensor: true, material: 'metal' });
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ isSensor: true, materialPreset: 'metal' }),
    );
  });
});

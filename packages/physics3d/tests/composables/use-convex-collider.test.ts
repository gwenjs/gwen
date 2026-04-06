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

import { useConvexCollider } from '../../src/composables/use-convex-collider.js';

describe('useConvexCollider', () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.addCollider.mockReturnValue(true);
    mockPhysics3D.removeCollider.mockReturnValue(true);
  });

  it('calls addCollider with shape.type === convex', () => {
    useConvexCollider({ vertices });
    const call = mockPhysics3D.addCollider.mock.calls[0][1];
    expect(call.shape.type).toBe('convex');
  });

  it('vertices are forwarded as the same reference', () => {
    useConvexCollider({ vertices });
    const call = mockPhysics3D.addCollider.mock.calls[0][1];
    expect(call.shape.vertices).toBe(vertices);
  });

  it('handle.colliderId is a number', () => {
    const handle = useConvexCollider({ vertices });
    expect(typeof handle.colliderId).toBe('number');
  });

  it('handle.remove() calls removeCollider with the correct colliderId', () => {
    const handle = useConvexCollider({ vertices });
    const cid = handle.colliderId;
    handle.remove();
    expect(mockPhysics3D.removeCollider).toHaveBeenCalledWith(1n, cid);
  });

  it('passes isSensor and material to addCollider', () => {
    useConvexCollider({ vertices, isSensor: true, material: 'rubber' });
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ isSensor: true, materialPreset: 'rubber' }),
    );
  });
});

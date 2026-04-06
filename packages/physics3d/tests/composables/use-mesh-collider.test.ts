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
  rebuildMeshCollider: vi.fn(() => true),
  _getBvhLoadState: vi.fn(() => null),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useMeshCollider } from '../../src/composables/use-mesh-collider.js';

describe('useMeshCollider', () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.addCollider.mockReturnValue(true);
    mockPhysics3D.removeCollider.mockReturnValue(true);
    mockPhysics3D.rebuildMeshCollider.mockReturnValue(true);
    mockPhysics3D._getBvhLoadState.mockReturnValue(null);
  });

  // ─── addCollider forwarding ───────────────────────────────────────────────
  it('calls addCollider with shape.type === mesh', () => {
    useMeshCollider({ vertices, indices });
    const call = mockPhysics3D.addCollider.mock.calls[0][1];
    expect(call.shape.type).toBe('mesh');
  });

  it('vertices are forwarded as the same reference', () => {
    useMeshCollider({ vertices, indices });
    const call = mockPhysics3D.addCollider.mock.calls[0][1];
    expect(call.shape.vertices).toBe(vertices);
  });

  it('indices are forwarded as the same reference', () => {
    useMeshCollider({ vertices, indices });
    const call = mockPhysics3D.addCollider.mock.calls[0][1];
    expect(call.shape.indices).toBe(indices);
  });

  it('passes isSensor to addCollider', () => {
    useMeshCollider({ vertices, indices, isSensor: true });
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ isSensor: true }),
    );
  });

  // ─── handle shape ─────────────────────────────────────────────────────────
  it('handle.colliderId is a number', () => {
    const handle = useMeshCollider({ vertices, indices });
    expect(typeof handle.colliderId).toBe('number');
  });

  it('handle.status is "active" after successful addCollider', () => {
    const handle = useMeshCollider({ vertices, indices });
    expect(handle.status).toBe('active');
  });

  it('handle.ready resolves for a successful collider', async () => {
    const handle = useMeshCollider({ vertices, indices });
    await expect(handle.ready).resolves.toBeUndefined();
  });

  it('handle.abort() does not throw', () => {
    const handle = useMeshCollider({ vertices, indices });
    expect(() => handle.abort()).not.toThrow();
  });

  // ─── remove ───────────────────────────────────────────────────────────────
  it('handle.remove() calls removeCollider with the correct colliderId', () => {
    const handle = useMeshCollider({ vertices, indices });
    const cid = handle.colliderId;
    handle.remove();
    expect(mockPhysics3D.removeCollider).toHaveBeenCalledWith(1n, cid);
  });

  // ─── rebuild ──────────────────────────────────────────────────────────────
  it('handle.rebuild() calls rebuildMeshCollider with new geometry', async () => {
    const handle = useMeshCollider({ vertices, indices });
    const newVerts = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    const newIdxs = new Uint32Array([0, 1, 2]);

    await handle.rebuild(newVerts, newIdxs);

    expect(mockPhysics3D.rebuildMeshCollider).toHaveBeenCalledWith(
      1n,
      handle.colliderId,
      newVerts,
      newIdxs,
      expect.objectContaining({}),
    );
  });

  it('handle.rebuild() resolves when rebuildMeshCollider returns true', async () => {
    const handle = useMeshCollider({ vertices, indices });
    await expect(handle.rebuild(vertices, indices)).resolves.toBeUndefined();
  });

  it('handle.status is "active" after successful rebuild', async () => {
    const handle = useMeshCollider({ vertices, indices });
    await handle.rebuild(vertices, indices);
    expect(handle.status).toBe('active');
  });

  it('handle.rebuild() throws and sets status "error" when rebuildMeshCollider returns false', async () => {
    mockPhysics3D.rebuildMeshCollider.mockReturnValueOnce(false);
    const handle = useMeshCollider({ vertices, indices });
    await expect(handle.rebuild(vertices, indices)).rejects.toThrow(
      'physics3d_rebuild_mesh_collider failed',
    );
    expect(handle.status).toBe('error');
  });
});

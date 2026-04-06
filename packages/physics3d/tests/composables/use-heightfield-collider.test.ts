import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Physics3DBodyHandle } from '../../src/types.js';

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

vi.mock('../../src/composables/collider-id.js', () => ({
  nextColliderId: vi.fn(() => 7),
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
  getLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  getAngularVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  addCollider: vi.fn(() => true),
  removeCollider: vi.fn(() => true),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useHeightfieldCollider } from '../../src/composables/use-heightfield-collider.js';

const makeHeights = (n: number) => new Float32Array(n);

describe('useHeightfieldCollider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.addCollider.mockReturnValue(true);
    mockPhysics3D.removeCollider.mockReturnValue(true);
  });

  it('calls addCollider with correct heightfield shape', () => {
    const heights = makeHeights(9); // 3×3
    useHeightfieldCollider({ heights, rows: 3, cols: 3, scaleX: 10, scaleY: 2, scaleZ: 10 });

    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        shape: {
          type: 'heightfield',
          heights,
          rows: 3,
          cols: 3,
          scaleX: 10,
          scaleY: 2,
          scaleZ: 10,
        },
      }),
    );
  });

  it('uses scaleX/Y/Z defaults of 1 when omitted', () => {
    const heights = makeHeights(4); // 2×2
    useHeightfieldCollider({ heights, rows: 2, cols: 2 });

    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        shape: expect.objectContaining({ scaleX: 1, scaleY: 1, scaleZ: 1 }),
      }),
    );
  });

  it('handle.colliderId equals the value from nextColliderId()', () => {
    const handle = useHeightfieldCollider({ heights: makeHeights(4), rows: 2, cols: 2 });
    expect(handle.colliderId).toBe(7);
  });

  it('handle.remove() calls removeCollider with entityId and colliderId', () => {
    const handle = useHeightfieldCollider({ heights: makeHeights(4), rows: 2, cols: 2 });
    handle.remove();
    expect(mockPhysics3D.removeCollider).toHaveBeenCalledWith(1n, 7);
  });

  it('handle.update() calls removeCollider then addCollider with new heights', () => {
    const original = makeHeights(9);
    const handle = useHeightfieldCollider({
      heights: original,
      rows: 3,
      cols: 3,
      scaleX: 10,
      scaleY: 1,
      scaleZ: 10,
    });

    vi.clearAllMocks();
    mockPhysics3D.removeCollider.mockReturnValue(true);
    mockPhysics3D.addCollider.mockReturnValue(true);

    const updated = new Float32Array(9);
    updated[4] = 5.0;
    handle.update(updated);

    expect(mockPhysics3D.removeCollider).toHaveBeenCalledWith(1n, 7);
    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        shape: expect.objectContaining({ heights: updated }),
        colliderId: 7,
      }),
    );
  });

  it('passes friction, restitution, layer, mask to addCollider', () => {
    const heights = makeHeights(4);
    useHeightfieldCollider({
      heights,
      rows: 2,
      cols: 2,
      friction: 0.8,
      restitution: 0.1,
      layer: 0b0001,
      mask: 0b1110,
    });

    expect(mockPhysics3D.addCollider).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        friction: 0.8,
        restitution: 0.1,
        layers: [0b0001],
        mask: [0b1110],
      }),
    );
  });
});

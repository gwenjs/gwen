/**
 * @file useBoxCollider() composable tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPhysics = {
  addRigidBody: vi.fn(() => 99),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 42n),
}));

vi.mock('@gwenjs/core', () => ({}));

import { useBoxCollider } from '../../src/composables/use-box-collider.js';

describe('useBoxCollider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(99);
  });

  it('calls addBoxCollider with half-extents (w/2, h/2)', () => {
    useBoxCollider({ w: 40, h: 20 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(99, 20, 10, expect.anything());
  });

  it('returns colliderId equal to the bodyHandle', () => {
    const h = useBoxCollider({ w: 10, h: 10 });
    expect(h.colliderId).toBe(99);
  });

  it('accepts d parameter (ignored in 2D) without throwing', () => {
    expect(() => useBoxCollider({ w: 10, h: 10, d: 5 })).not.toThrow();
  });

  it('passes isSensor correctly to addBoxCollider', () => {
    useBoxCollider({ w: 10, h: 10, isSensor: true });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ isSensor: true }),
    );
  });

  it('isSensor defaults to false in the returned handle', () => {
    const h = useBoxCollider({ w: 10, h: 10 });
    expect(h.isSensor).toBe(false);
  });

  it('passes offsetX/offsetY to addRigidBody as position', () => {
    useBoxCollider({ w: 10, h: 10, offsetX: 5, offsetY: 3 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(expect.anything(), 'fixed', 5, 3);
  });

  it('defaults offsetX/offsetY to 0', () => {
    useBoxCollider({ w: 10, h: 10 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(expect.anything(), 'fixed', 0, 0);
  });

  it('passes layer as membershipLayers and mask as filterLayers', () => {
    useBoxCollider({ w: 10, h: 10, layer: 4, mask: 3 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ membershipLayers: 4, filterLayers: 3 }),
    );
  });

  it('creates a fixed body (not dynamic)', () => {
    useBoxCollider({ w: 10, h: 10 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      'fixed',
      expect.anything(),
      expect.anything(),
    );
  });
});

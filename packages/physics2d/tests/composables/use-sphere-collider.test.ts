/**
 * @file useSphereCollider() composable tests.
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

import { useSphereCollider } from '../../src/composables/use-sphere-collider.js';

describe('useSphereCollider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(99);
  });

  it('calls addBallCollider with the correct radius', () => {
    useSphereCollider({ radius: 16 });
    expect(mockPhysics.addBallCollider).toHaveBeenCalledWith(99, 16, expect.anything());
  });

  it('returns colliderId equal to the bodyHandle', () => {
    expect(useSphereCollider({ radius: 8 }).colliderId).toBe(99);
  });

  it('isSensor defaults to false', () => {
    expect(useSphereCollider({ radius: 8 }).isSensor).toBe(false);
  });

  it('passes isSensor: true to addBallCollider', () => {
    useSphereCollider({ radius: 10, isSensor: true });
    expect(mockPhysics.addBallCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ isSensor: true }),
    );
    expect(useSphereCollider({ radius: 10, isSensor: true }).isSensor).toBe(true);
  });

  it('passes offsetX/offsetY to addRigidBody', () => {
    useSphereCollider({ radius: 10, offsetX: 2, offsetY: 4 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(expect.anything(), 'fixed', 2, 4);
  });

  it('passes layer/mask to addBallCollider', () => {
    useSphereCollider({ radius: 10, layer: 1, mask: 6 });
    expect(mockPhysics.addBallCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ membershipLayers: 1, filterLayers: 6 }),
    );
  });

  it('creates a fixed body', () => {
    useSphereCollider({ radius: 5 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      'fixed',
      expect.anything(),
      expect.anything(),
    );
  });

  it('never calls addBoxCollider', () => {
    useSphereCollider({ radius: 5 });
    expect(mockPhysics.addBoxCollider).not.toHaveBeenCalled();
  });
});

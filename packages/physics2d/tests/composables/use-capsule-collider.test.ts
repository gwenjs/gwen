/**
 * @file useCapsuleCollider() composable tests.
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

import { useCapsuleCollider } from '../../src/composables/use-capsule-collider.js';

describe('useCapsuleCollider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(99);
  });

  it('creates a rigid body (capsule approximation)', () => {
    useCapsuleCollider({ radius: 10, height: 40 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalled();
  });

  it('returns colliderId equal to the bodyHandle', () => {
    expect(useCapsuleCollider({ radius: 10, height: 40 }).colliderId).toBe(99);
  });

  it('isSensor defaults to false', () => {
    expect(useCapsuleCollider({ radius: 10, height: 40 }).isSensor).toBe(false);
  });

  it('uses addBoxCollider (capsule approximation via box)', () => {
    useCapsuleCollider({ radius: 10, height: 40 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
    expect(mockPhysics.addBallCollider).not.toHaveBeenCalled();
  });

  it('uses radius as half-width and height/2 as half-height', () => {
    useCapsuleCollider({ radius: 10, height: 40 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(99, 10, 20, expect.anything());
  });

  it('passes isSensor to addBoxCollider', () => {
    useCapsuleCollider({ radius: 10, height: 40, isSensor: true });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ isSensor: true }),
    );
  });

  it('passes offsetX/offsetY to addRigidBody', () => {
    useCapsuleCollider({ radius: 10, height: 40, offsetX: 1, offsetY: 2 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(expect.anything(), 'fixed', 1, 2);
  });

  it('passes layer/mask to addBoxCollider', () => {
    useCapsuleCollider({ radius: 10, height: 40, layer: 2, mask: 4 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ membershipLayers: 2, filterLayers: 4 }),
    );
  });
});

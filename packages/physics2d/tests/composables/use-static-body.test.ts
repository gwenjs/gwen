/**
 * @file useStaticBody() composable tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPhysics = {
  addRigidBody: vi.fn(() => 99),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
  applyImpulse: vi.fn(),
  setLinearVelocity: vi.fn(),
  getLinearVelocity: vi.fn(() => ({ x: 1.5, y: 2.5 })),
};

const mockEngine = {
  getComponent: vi.fn(() => undefined),
};

vi.mock('../../src/composables.js', () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock('@gwenjs/core/scene', () => ({
  _getActorEntityId: vi.fn(() => 42n),
}));

vi.mock('@gwenjs/core', () => ({
  useEngine: vi.fn(() => mockEngine),
}));

vi.mock('../../src/shape-component.js', () => ({
  ShapeComponent: { name: 'Shape', schema: {} },
}));

import { useStaticBody } from '../../src/composables/use-static-body.js';

describe('useStaticBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(99);
  });

  it('calls addRigidBody with type "fixed"', () => {
    useStaticBody();
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(expect.anything(), 'fixed', 0, 0);
  });

  it('adds a box collider by default', () => {
    useStaticBody();
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
  });

  it('returns the bodyHandle as bodyId', () => {
    const h = useStaticBody();
    expect(h.bodyId).toBe(99);
  });

  it('is active by default', () => {
    expect(useStaticBody().active).toBe(true);
  });

  it('disable() calls removeBody and sets active to false', () => {
    const h = useStaticBody();
    h.disable();
    expect(mockPhysics.removeBody).toHaveBeenCalled();
    expect(h.active).toBe(false);
  });

  it('enable() restores active state after disable', () => {
    const h = useStaticBody();
    h.disable();
    h.enable();
    expect(h.active).toBe(true);
  });

  it('passes layer as membershipLayers and mask as filterLayers', () => {
    useStaticBody({ layer: 4, mask: 3 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ membershipLayers: 4, filterLayers: 3 }),
    );
  });

  it('passes isSensor flag to the collider', () => {
    useStaticBody({ isSensor: true });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ isSensor: true }),
    );
  });

  it('uses addBallCollider when shape is "ball"', () => {
    useStaticBody({ shape: 'ball' });
    expect(mockPhysics.addBallCollider).toHaveBeenCalled();
    expect(mockPhysics.addBoxCollider).not.toHaveBeenCalled();
  });

  it('uses addBoxCollider when shape is "box"', () => {
    useStaticBody({ shape: 'box' });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
    expect(mockPhysics.addBallCollider).not.toHaveBeenCalled();
  });

  it('enable() after disable() re-creates the body', () => {
    const h = useStaticBody();
    h.disable();
    mockPhysics.addRigidBody.mockClear();
    mockPhysics.addBoxCollider.mockClear();
    h.enable();
    // Should have re-called addRigidBody to recreate the body
    expect(mockPhysics.addRigidBody).toHaveBeenCalledTimes(1);
    expect(h.active).toBe(true);
  });

  it('disable() is idempotent', () => {
    const h = useStaticBody();
    h.disable();
    h.disable();
    // removeBody called only once
    expect(mockPhysics.removeBody).toHaveBeenCalledTimes(1);
  });

  it('uses addBoxCollider when no shape specified', () => {
    useStaticBody({});
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
    expect(mockPhysics.addBallCollider).not.toHaveBeenCalled();
  });

  it('passes default half-extents (0.5, 0.5) to box collider', () => {
    useStaticBody();
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(99, 0.5, 0.5, expect.anything());
  });

  it('passes default radius (0.5) to ball collider', () => {
    useStaticBody({ shape: 'ball' });
    expect(mockPhysics.addBallCollider).toHaveBeenCalledWith(99, 0.5, expect.anything());
  });

  it('reads Shape component for box dimensions when present', () => {
    mockEngine.getComponent.mockReturnValue({ w: 100, h: 40, radius: 0, depth: 0 });

    useStaticBody();

    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.any(Number),
      50, // w/2
      20, // h/2
      expect.anything(),
    );
  });

  it('reads Shape component radius for ball shape when present', () => {
    mockEngine.getComponent.mockReturnValue({ w: 0, h: 0, radius: 25, depth: 0 });

    useStaticBody({ shape: 'ball' });

    expect(mockPhysics.addBallCollider).toHaveBeenCalledWith(
      expect.any(Number),
      25, // radius from Shape
      expect.anything(),
    );
  });

  it('falls back to 0.5 defaults when Shape component absent', () => {
    mockEngine.getComponent.mockReturnValue(undefined);

    useStaticBody();

    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.any(Number),
      0.5, // default hw
      0.5, // default hh
      expect.anything(),
    );
  });
});

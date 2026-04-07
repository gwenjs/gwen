/**
 * @file useDynamicBody() composable tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPhysics = {
  addRigidBody: vi.fn(() => 99),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
  applyImpulse: vi.fn(),
  setLinearVelocity: vi.fn(),
  getLinearVelocity: vi.fn(() => ({ x: 1.5, y: 2.5 })),
};

let capturedOnBeforeUpdate: ((dt: number) => void) | undefined;

vi.mock("../../src/composables.js", () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock("@gwenjs/core/actor", () => ({
  _getActorEntityId: vi.fn(() => 42n),
  onBeforeUpdate: vi.fn((cb: (dt: number) => void) => {
    capturedOnBeforeUpdate = cb;
  }),
}));

vi.mock("@gwenjs/core", () => ({}));

import { useDynamicBody } from "../../src/composables/use-dynamic-body.js";

describe("useDynamicBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnBeforeUpdate = undefined;
    mockPhysics.addRigidBody.mockReturnValue(99);
    mockPhysics.getLinearVelocity.mockReturnValue({ x: 1.5, y: 2.5 });
  });

  it('calls addRigidBody with type "dynamic"', () => {
    useDynamicBody();
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.anything(),
    );
  });

  it("returns the bodyHandle as bodyId", () => {
    const h = useDynamicBody();
    expect(h.bodyId).toBe(99);
  });

  it("is active by default", () => {
    expect(useDynamicBody().active).toBe(true);
  });

  it("applyImpulse delegates to physics.applyImpulse", () => {
    const h = useDynamicBody();
    h.applyImpulse(10, 20);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(expect.anything(), 10, 20);
  });

  it("setVelocity delegates to physics.setLinearVelocity", () => {
    const h = useDynamicBody();
    h.setVelocity(3, 4);
    expect(mockPhysics.setLinearVelocity).toHaveBeenCalledWith(expect.anything(), 3, 4);
  });

  it("velocity getter returns current velocity from physics", () => {
    const h = useDynamicBody();
    expect(h.velocity).toEqual({ x: 1.5, y: 2.5 });
  });

  it("velocity getter returns { x:0, y:0 } when getLinearVelocity returns null", () => {
    mockPhysics.getLinearVelocity.mockReturnValue(null);
    const h = useDynamicBody();
    expect(h.velocity).toEqual({ x: 0, y: 0 });
  });

  it("passes mass and linearDamping options to addRigidBody", () => {
    useDynamicBody({ mass: 5, linearDamping: 0.1 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.objectContaining({ mass: 5, linearDamping: 0.1 }),
    );
  });

  it("passes angularDamping and gravityScale options to addRigidBody", () => {
    useDynamicBody({ angularDamping: 0.2, gravityScale: 2.5 });
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.objectContaining({ angularDamping: 0.2, gravityScale: 2.5 }),
    );
  });

  it('uses addBallCollider when shape is "ball"', () => {
    useDynamicBody({ shape: "ball" });
    expect(mockPhysics.addBallCollider).toHaveBeenCalled();
    expect(mockPhysics.addBoxCollider).not.toHaveBeenCalled();
  });

  it("uses addBoxCollider by default", () => {
    useDynamicBody();
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
  });

  it("disable() calls removeBody and sets active to false", () => {
    const h = useDynamicBody();
    h.disable();
    expect(mockPhysics.removeBody).toHaveBeenCalled();
    expect(h.active).toBe(false);
  });

  it("enable() restores active after disable", () => {
    const h = useDynamicBody();
    h.disable();
    h.enable();
    expect(h.active).toBe(true);
  });

  it("applyForce accumulates and flushes as impulse * dt on the next frame", () => {
    const h = useDynamicBody();
    h.applyForce(100, 200);
    // Before the frame ticks, no impulse yet
    expect(mockPhysics.applyImpulse).not.toHaveBeenCalled();
    // Simulate a frame tick
    capturedOnBeforeUpdate!(0.016);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(
      expect.anything(),
      100 * 0.016,
      200 * 0.016,
    );
  });

  it("applyForce accumulates multiple calls within a frame", () => {
    const h = useDynamicBody();
    h.applyForce(100, 0);
    h.applyForce(0, 200);
    capturedOnBeforeUpdate!(0.016);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(
      expect.anything(),
      100 * 0.016,
      200 * 0.016,
    );
  });

  it("applyForce accumulator resets after each frame flush", () => {
    const h = useDynamicBody();
    h.applyForce(100, 200);
    capturedOnBeforeUpdate!(0.016);
    vi.clearAllMocks();
    // No force applied this frame — no impulse should fire
    capturedOnBeforeUpdate!(0.016);
    expect(mockPhysics.applyImpulse).not.toHaveBeenCalled();
  });

  it("passes layer/mask as membershipLayers/filterLayers", () => {
    useDynamicBody({ layer: 2, mask: 1 });
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ membershipLayers: 2, filterLayers: 1 }),
    );
  });
});

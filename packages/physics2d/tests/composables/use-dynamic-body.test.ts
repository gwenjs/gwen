/**
 * @file useDynamicBody() composable tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { defineSystem } from "@gwenjs/core/system";

const mockPhysics = {
  addRigidBody: vi.fn(() => 99),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
  applyImpulse: vi.fn(),
  setLinearVelocity: vi.fn(),
  getLinearVelocity: vi.fn(() => ({ x: 1.5, y: 2.5 })),
};

vi.mock("../../src/composables.js", () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock("@gwenjs/core/internal", () => ({
  _getActorEntityId: vi.fn(() => 42n),
}));

vi.mock("@gwenjs/core", () => ({}));

import { useDynamicBody } from "../../src/composables/use-dynamic-body.js";

describe("useDynamicBody", () => {
  let engine: Awaited<ReturnType<typeof createEngine>>;

  beforeEach(async () => {
    // maxDeltaSeconds 10: advance() caps dt at 0.1 by default, which would hide the dt 0.5 and 1.0 cases.
    engine = await createEngine({ maxDeltaSeconds: 10 });
  });

  afterEach(async () => {
    await engine.stop();
  });

  // The real onBeforeUpdate needs a scope: a system is the lightest one, and advance() runs the real frame.
  async function mount<T>(setup: () => T): Promise<T> {
    let result!: T;
    await engine.use(
      defineSystem("use-dynamic-body-test", () => {
        result = setup();
      })(),
    );
    return result;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics.addRigidBody.mockReturnValue(99);
    mockPhysics.getLinearVelocity.mockReturnValue({ x: 1.5, y: 2.5 });
  });

  it('calls addRigidBody with type "dynamic"', async () => {
    await mount(() => useDynamicBody());
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.anything(),
    );
  });

  it("returns the bodyHandle as bodyId", async () => {
    const h = await mount(() => useDynamicBody());
    expect(h.bodyId).toBe(99);
  });

  it("is active by default", async () => {
    expect((await mount(() => useDynamicBody())).active).toBe(true);
  });

  it("applyImpulse delegates to physics.applyImpulse", async () => {
    const h = await mount(() => useDynamicBody());
    h.applyImpulse(10, 20);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(expect.anything(), 10, 20);
  });

  it("setVelocity delegates to physics.setLinearVelocity", async () => {
    const h = await mount(() => useDynamicBody());
    h.setVelocity(3, 4);
    expect(mockPhysics.setLinearVelocity).toHaveBeenCalledWith(expect.anything(), 3, 4);
  });

  it("velocity getter returns current velocity from physics", async () => {
    const h = await mount(() => useDynamicBody());
    expect(h.velocity).toEqual({ x: 1.5, y: 2.5 });
  });

  it("velocity getter returns { x:0, y:0 } when getLinearVelocity returns null", async () => {
    mockPhysics.getLinearVelocity.mockReturnValue(null);
    const h = await mount(() => useDynamicBody());
    expect(h.velocity).toEqual({ x: 0, y: 0 });
  });

  it("passes fixedRotation on create and again after disable and enable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const body = await mount(() => useDynamicBody({ fixedRotation: true }));
      expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
        expect.anything(),
        "dynamic",
        0,
        0,
        expect.objectContaining({ fixedRotation: true }),
      );
      body.disable();
      body.enable();
      expect(mockPhysics.addRigidBody).toHaveBeenLastCalledWith(
        expect.anything(),
        "dynamic",
        0,
        0,
        expect.objectContaining({ fixedRotation: true }),
      );
      expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
        "not yet supported",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("passes mass and linearDamping options to addRigidBody", async () => {
    await mount(() => useDynamicBody({ mass: 5, linearDamping: 0.1 }));
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.objectContaining({ mass: 5, linearDamping: 0.1 }),
    );
  });

  it("passes angularDamping and gravityScale options to addRigidBody", async () => {
    await mount(() => useDynamicBody({ angularDamping: 0.2, gravityScale: 2.5 }));
    expect(mockPhysics.addRigidBody).toHaveBeenCalledWith(
      expect.anything(),
      "dynamic",
      0,
      0,
      expect.objectContaining({ angularDamping: 0.2, gravityScale: 2.5 }),
    );
  });

  it('uses addBallCollider when shape is "ball"', async () => {
    await mount(() => useDynamicBody({ shape: "ball" }));
    expect(mockPhysics.addBallCollider).toHaveBeenCalled();
    expect(mockPhysics.addBoxCollider).not.toHaveBeenCalled();
  });

  it("uses addBoxCollider by default", async () => {
    await mount(() => useDynamicBody());
    expect(mockPhysics.addBoxCollider).toHaveBeenCalled();
  });

  it("disable() calls removeBody and sets active to false", async () => {
    const h = await mount(() => useDynamicBody());
    h.disable();
    expect(mockPhysics.removeBody).toHaveBeenCalled();
    expect(h.active).toBe(false);
  });

  it("enable() restores active after disable", async () => {
    const h = await mount(() => useDynamicBody());
    h.disable();
    h.enable();
    expect(h.active).toBe(true);
  });

  it("applyForce accumulates and flushes as impulse * dt on the next frame", async () => {
    const h = await mount(() => useDynamicBody());
    h.applyForce(100, 200);
    // Before the frame ticks, no impulse yet
    expect(mockPhysics.applyImpulse).not.toHaveBeenCalled();
    // Simulate a frame tick
    await engine.advance(0.016);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(
      expect.anything(),
      100 * 0.016,
      200 * 0.016,
    );
  });

  it("applyForce accumulates multiple calls within a frame", async () => {
    const h = await mount(() => useDynamicBody());
    h.applyForce(100, 0);
    h.applyForce(0, 200);
    await engine.advance(0.016);
    expect(mockPhysics.applyImpulse).toHaveBeenCalledWith(
      expect.anything(),
      100 * 0.016,
      200 * 0.016,
    );
  });

  it("applyForce accumulator resets after each frame flush", async () => {
    const h = await mount(() => useDynamicBody());
    h.applyForce(100, 200);
    await engine.advance(0.016);
    vi.clearAllMocks();
    // No force applied this frame — no impulse should fire
    await engine.advance(0.016);
    expect(mockPhysics.applyImpulse).not.toHaveBeenCalled();
  });

  it("passes layer/mask as layer/mask", async () => {
    await mount(() => useDynamicBody({ layer: 2, mask: 1 }));
    expect(mockPhysics.addBoxCollider).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ layer: 2, mask: 1 }),
    );
  });
});

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { defineSystem } from "@gwenjs/core/system";
import type { Physics3DBodyHandle } from "../../src/types.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@gwenjs/core/internal", () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle: Physics3DBodyHandle = {
  bodyId: 42,
  entityId: 0,
  kind: "dynamic",
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

vi.mock("../../src/composables.js", () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useDynamicBody } from "../../src/composables/use-dynamic-body.js";
import { _getActorEntityId } from "@gwenjs/core/internal";

const DT = 0.016;

describe("useDynamicBody", () => {
  let engine: Awaited<ReturnType<typeof createEngine>>;

  beforeEach(async () => {
    // maxDeltaSeconds 10: advance() caps dt at 0.1 by default, which would hide a large dt.
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
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    mockPhysics3D.removeBody.mockReturnValue(true);
    mockPhysics3D.getLinearVelocity.mockReturnValue({ x: 1, y: 2, z: 3 });
    mockPhysics3D.getAngularVelocity.mockReturnValue({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it("calls createBody with kind: dynamic", async () => {
    await mount(() => useDynamicBody());
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({ kind: "dynamic" }),
    );
  });

  it("handle.bodyId equals mockBodyHandle.bodyId (42)", async () => {
    const handle = await mount(() => useDynamicBody());
    expect(handle.bodyId).toBe(42);
  });

  it("handle.active is true initially", async () => {
    const handle = await mount(() => useDynamicBody());
    expect(handle.active).toBe(true);
  });

  it("applyImpulse(4,5,6) calls applyImpulse with {x:4, y:5, z:6}", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyImpulse(4, 5, 6);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, { x: 4, y: 5, z: 6 });
  });

  it("applyTorque(7,8,9) calls applyTorque with {x:7, y:8, z:9}", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyTorque(7, 8, 9);
    expect(mockPhysics3D.applyTorque).toHaveBeenCalledWith(1n, { x: 7, y: 8, z: 9 });
  });

  it("setVelocity(1,2,3) calls setLinearVelocity with {x:1, y:2, z:3}", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.setVelocity(1, 2, 3);
    expect(mockPhysics3D.setLinearVelocity).toHaveBeenCalledWith(1n, { x: 1, y: 2, z: 3 });
  });

  it("velocity getter returns {x:1, y:2, z:3} from mock", async () => {
    const handle = await mount(() => useDynamicBody());
    expect(handle.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("angularVelocity getter returns {x:0.1, y:0.2, z:0.3} from mock", async () => {
    const handle = await mount(() => useDynamicBody());
    expect(handle.angularVelocity).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
  });

  it("velocity returns zero vector when body is inactive", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.disable();
    mockPhysics3D.getLinearVelocity.mockReturnValue(undefined);
    expect(handle.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("angularVelocity returns zero vector when getAngularVelocity returns undefined", async () => {
    const handle = await mount(() => useDynamicBody());
    mockPhysics3D.getAngularVelocity.mockReturnValue(undefined);
    expect(handle.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("disable() calls removeBody and sets active to false", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.disable();
    expect(mockPhysics3D.removeBody).toHaveBeenCalledWith(1n);
    expect(handle.active).toBe(false);
  });

  it("enable() after disable calls createBody again and sets active to true", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.disable();
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
    handle.enable();
    expect(mockPhysics3D.createBody).toHaveBeenCalled();
    expect(handle.active).toBe(true);
  });

  it("enable() when already enabled is a no-op", async () => {
    const handle = await mount(() => useDynamicBody());
    vi.clearAllMocks();
    handle.enable();
    expect(mockPhysics3D.createBody).not.toHaveBeenCalled();
  });

  it("disable() when already disabled is a no-op", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.disable();
    vi.clearAllMocks();
    handle.disable();
    expect(mockPhysics3D.removeBody).not.toHaveBeenCalled();
  });

  it("applyForce is a no-op when body is inactive", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.disable();
    vi.clearAllMocks();
    handle.applyForce(1, 2, 3);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });

  it("passes options to createBody (mass, gravityScale, etc.)", async () => {
    await mount(() => useDynamicBody({ mass: 5, gravityScale: 0.5, ccdEnabled: true }));
    expect(mockPhysics3D.createBody).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        kind: "dynamic",
        mass: 5,
        gravityScale: 0.5,
        ccdEnabled: true,
      }),
    );
  });

  it("applyForce accumulates force×dt into one impulse per frame", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(100, 200, 300);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledTimes(1);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, {
      x: 100 * DT,
      y: 200 * DT,
      z: 300 * DT,
    });
  });

  it("applyForce called several times in a frame sums into one impulse", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(10, 0, 0);
    handle.applyForce(20, 5, 0);
    handle.applyForce(0, 0, 7);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledTimes(1);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, {
      x: 30 * DT,
      y: 5 * DT,
      z: 7 * DT,
    });
  });

  it("the accumulator is empty after a flush", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(4, 5, 6);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });

  it("applyForce is dropped when the body is disabled before the flush", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(100, 200, 300);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    handle.disable();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    handle.enable();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });

  it("a zero force never reaches applyImpulse", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(0, 0, 0);
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });

  it("two bodies keep separate accumulators", async () => {
    vi.mocked(_getActorEntityId).mockReturnValueOnce(1n).mockReturnValueOnce(2n);
    const [first, second] = await mount(() => [useDynamicBody(), useDynamicBody()]);
    first.applyForce(100, 0, 0);
    second.applyForce(0, 40, 0);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledTimes(2);
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(1n, { x: 100 * DT, y: 0, z: 0 });
    expect(mockPhysics3D.applyImpulse).toHaveBeenCalledWith(2n, { x: 0, y: 40 * DT, z: 0 });
  });

  it("a zero dt flushes nothing and clears the accumulator", async () => {
    const handle = await mount(() => useDynamicBody());
    handle.applyForce(10, 20, 30);
    await engine.advance(0);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
    await engine.advance(DT);
    expect(mockPhysics3D.applyImpulse).not.toHaveBeenCalled();
  });
});

/**
 * @file Bulk-operation behaviour for composables.
 * Wall-clock budgets for the same operations live in `bench/timing-gate.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let _bodyIdCounter = 0;

const mockPhysics = {
  addRigidBody: vi.fn(() => ++_bodyIdCounter),
  addBoxCollider: vi.fn(),
  addBallCollider: vi.fn(),
  removeBody: vi.fn(),
  applyImpulse: vi.fn(),
  setLinearVelocity: vi.fn(),
  getLinearVelocity: vi.fn(() => ({ x: 0, y: 0 })),
};

vi.mock("../../src/composables.js", () => ({
  usePhysics2D: vi.fn(() => mockPhysics),
}));

vi.mock("@gwenjs/core/internal", () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));
vi.mock("@gwenjs/core/actor", () => ({
  onBeforeUpdate: vi.fn(),
}));

vi.mock("@gwenjs/core", () => ({
  useEngine: vi.fn(() => ({ getComponent: vi.fn(() => undefined) })),
}));

vi.mock("../../src/shape-component.js", () => ({
  ShapeComponent: { name: "Shape", schema: {} },
}));

import { useStaticBody } from "../../src/composables/use-static-body.js";

describe("Bulk operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _bodyIdCounter = 0;
    mockPhysics.addRigidBody.mockImplementation(() => ++_bodyIdCounter);
  });

  it("creates 1000 static bodies, one rigid body each", () => {
    for (let i = 0; i < 1_000; i++) {
      useStaticBody();
    }
    expect(mockPhysics.addRigidBody).toHaveBeenCalledTimes(1_000);
  });

  it("forwards 1000 impulses to the physics service", async () => {
    const { useDynamicBody } = await import("../../src/composables/use-dynamic-body.js");
    const body = useDynamicBody();
    for (let i = 0; i < 1_000; i++) {
      body.applyImpulse(1, 0);
    }
    expect(mockPhysics.applyImpulse).toHaveBeenCalledTimes(1_000);
  });
});

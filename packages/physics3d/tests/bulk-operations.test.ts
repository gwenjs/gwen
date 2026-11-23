/**
 * Bulk-operation behaviour: body creation and contact dispatch at
 * frame-sized counts. Wall-clock budgets for the same operations
 * live in `bench/timing-gate.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { defineSystem } from "@gwenjs/core/system";

// ─── Mocks for dynamic body test ─────────────────────────────────────

vi.mock("@gwenjs/core/internal", () => ({
  _getActorEntityId: vi.fn(() => 1n),
}));

const mockBodyHandle = {
  bodyId: 1,
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
  getLinearVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  getAngularVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  addCollider: vi.fn(() => true),
  removeCollider: vi.fn(() => true),
};

vi.mock("../src/composables.js", () => ({
  usePhysics3D: vi.fn(() => mockPhysics3D),
}));

import { useDynamicBody } from "../src/composables/use-dynamic-body.js";
import {
  onContact,
  _dispatchContactEvent,
  _clearContactCallbacks,
} from "../src/composables/on-contact.js";
import type { CollisionContact } from "../src/types.js";

describe("physics3d bulk operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPhysics3D.createBody.mockReturnValue(mockBodyHandle);
  });

  // onBeforeUpdate needs a system scope, so the 500 bodies share one mount().
  async function mount(setup: () => void): Promise<void> {
    const engine = await createEngine({ maxDeltaSeconds: 10 });
    try {
      await engine.use(
        defineSystem("bulk-dynamic-bodies", () => {
          setup();
        })(),
      );
    } finally {
      await engine.stop();
    }
  }

  it("creates 500 dynamic bodies, one physics body each", async () => {
    await mount(() => {
      for (let i = 0; i < 500; i++) {
        useDynamicBody();
      }
    });
    expect(mockPhysics3D.createBody).toHaveBeenCalledTimes(500);
  });

  it("delivers 500 contact dispatches in one frame to the callback", async () => {
    const engine = await createEngine();
    engine.activate();
    try {
      _clearContactCallbacks();
      let calls = 0;
      let last: CollisionContact | undefined;
      onContact((contact) => {
        calls += 1;
        last = contact;
      });

      const event: CollisionContact = {
        entityA: 1n,
        entityB: 2n,
        started: true,
      };

      for (let i = 0; i < 500; i++) {
        _dispatchContactEvent(event);
      }

      expect(calls).toBe(500);
      expect(last).toBe(event);
      _clearContactCallbacks();
    } finally {
      engine.deactivate();
      await engine.stop();
    }
  });
});

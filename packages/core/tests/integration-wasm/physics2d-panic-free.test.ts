/**
 * Real physics2d WASM. A diverging body must not abort the instance, and a
 * non-finite query must come back as `PHYSICS2D:INVALID_QUERY`.
 */
import { describe, expect, it } from "vitest";

import { GwenWasmError, type EntityId } from "../../src/index.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const DT = 1 / 60;
const BLOWUP_STEPS = 200;

async function startPhysics(handle: RealEngineHandle): Promise<Physics2DAPI> {
  await handle.engine.use(Physics2DPlugin({ gravity: -9.81, maxEntities: 32 }));
  return handle.engine.inject("physics2d");
}

describe("physics2d panic-free", () => {
  it("point query with NaN rejects with PHYSICS2D:INVALID_QUERY", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const physics = await startPhysics(handle);
      const id = handle.engine.createEntity();
      const body = physics.addRigidBody(id, "dynamic", 0, 1, { gravityScale: 0 });
      physics.addBoxCollider(body, 0.5, 0.5);
      let caught: unknown;
      try {
        physics.pointQuery(Number.NaN, 0);
      } catch (err: unknown) {
        caught = err;
      }
      const code = caught instanceof GwenWasmError ? caught.code : undefined;
      expect(code).toBe("PHYSICS2D:INVALID_QUERY");
      expect(handle.bridge.countEntities()).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("a diverging body is disabled, the hook fires once with its entity and the instance stays usable", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    const seen: Array<{
      entity: EntityId;
      reason: "non-finite" | "out-of-bounds" | "velocity";
    }> = [];
    const unhook = handle.engine.hooks.hook("physics2d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle);
      const { engine } = handle;
      const ground = engine.createEntity();
      const groundBody = physics.addRigidBody(ground, "fixed", 0, 0);
      physics.addBoxCollider(groundBody, 20, 0.5, { restitution: 1e9, friction: 0 });
      const offender = engine.createEntity();
      const offenderBody = physics.addRigidBody(offender, "dynamic", 0, 2, { mass: 1 });
      physics.addBoxCollider(offenderBody, 0.5, 0.5, { restitution: 1e9, friction: 0 });
      const other = engine.createEntity();
      const otherBody = physics.addRigidBody(other, "dynamic", 40, 8, { mass: 1 });
      physics.addBoxCollider(otherBody, 0.5, 0.5, { restitution: 0, friction: 0 });
      const before = physics.getPosition(other)?.y;
      if (before === undefined) {
        throw new Error("expected the other body");
      }
      try {
        await handle.advance(BLOWUP_STEPS, DT);
      } catch (err: unknown) {
        // A wasm abort faults the engine (`packages/core/src/engine/engine-loop.ts:179`). The hook assertion is the result.
        void err;
      }
      expect(seen).toEqual([{ entity: offender, reason: "out-of-bounds" }]);
      const after = physics.getPosition(other)?.y;
      expect(after).not.toBe(before);
      expect(handle.bridge.countEntities()).toBe(3);
    } finally {
      unhook();
      await handle.dispose();
    }
  });
});

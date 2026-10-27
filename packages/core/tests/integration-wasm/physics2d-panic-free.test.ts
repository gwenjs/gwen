/**
 * Real physics2d WASM. A diverging body must not abort the instance, and a
 * non-finite query must come back as `PHYSICS2D:INVALID_QUERY`.
 */
import { describe, expect, it } from "vitest";

import { GwenWasmError, type EntityId } from "../../src/index.js";
import "../../../physics2d/src/augment";
import { Physics2DErrorCodes } from "../../../physics2d/src/errors";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const DT = 1 / 60;
const BLOWUP_STEPS = 200;
const MAX_LINEAR_VELOCITY = 400;
/** Next f32 above 1e7. Integers below 2^24 are exact, so this is `next_up`. */
const PAST_WORLD_EXTENT = 1e7 + 1;
/** Measured peak |y| for restitution 1e9 is 1103.57666. A fall from y = 2 stays near 2. */
const MEASURED_PEAK_FLOOR = 1100;
const RESTITUTION_BLOWUP = 1e9;

async function startPhysics(
  handle: RealEngineHandle,
  gravity = -9.81,
  maxLinearVelocity?: number,
): Promise<Physics2DAPI> {
  await handle.engine.use(
    Physics2DPlugin({
      gravity,
      maxEntities: 32,
      ...(maxLinearVelocity === undefined ? {} : { maxLinearVelocity }),
    }),
  );
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
      expect(Physics2DErrorCodes.INVALID_QUERY).toBe("PHYSICS2D:INVALID_QUERY");
      expect(code).toBe(Physics2DErrorCodes.INVALID_QUERY);
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
      physics.addBoxCollider(groundBody, 20, 0.5, { restitution: 0, friction: 0 });
      const offender = engine.createEntity();
      // Restitution 1e9 no longer leaves ±1e7: Rapier 0.36.1 caps speed at 400 m/s.
      // The next f32 past 1e7 is disabled on the first step (out-of-bounds).
      const offenderBody = physics.addRigidBody(offender, "dynamic", PAST_WORLD_EXTENT, 2, {
        mass: 1,
      });
      physics.addBoxCollider(offenderBody, 0.5, 0.5, { restitution: 0, friction: 0 });
      const other = engine.createEntity();
      const otherBody = physics.addRigidBody(other, "dynamic", 40, 8, { mass: 1 });
      physics.addBoxCollider(otherBody, 0.5, 0.5, { restitution: 0, friction: 0 });
      const before = physics.getPosition(other)?.y;
      if (before === undefined) {
        throw new Error("expected the other body");
      }
      let advanceError: unknown;
      try {
        for (let step = 0; step < BLOWUP_STEPS; step += 1) {
          await handle.advance(1, DT);
          if (seen.length > 0) break;
        }
      } catch (err: unknown) {
        // A wasm abort faults the engine (`packages/core/src/engine/engine-loop.ts:179`). The hook assertion is the result.
        advanceError = err;
      }
      expect(seen).toEqual([{ entity: offender, reason: "out-of-bounds" }]);
      expect(advanceError).toBeUndefined();
      const atDisable = physics.getPosition(other)?.y;
      expect(atDisable).not.toBe(before);
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: offender, reason: "out-of-bounds" }]);
      expect(physics.getPosition(other)?.y).not.toBe(atDisable);
      expect(handle.bridge.countEntities()).toBe(3);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("restitution 1e9 stays enabled and bounded, the hook stays silent and the instance keeps stepping", async () => {
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
      physics.addBoxCollider(groundBody, 20, 0.5, {
        restitution: RESTITUTION_BLOWUP,
        friction: 0,
      });
      const offender = engine.createEntity();
      const offenderBody = physics.addRigidBody(offender, "dynamic", 0, 2, { mass: 1 });
      physics.addBoxCollider(offenderBody, 0.5, 0.5, {
        restitution: RESTITUTION_BLOWUP,
        friction: 0,
      });
      const other = engine.createEntity();
      const otherBody = physics.addRigidBody(other, "dynamic", 40, 8, { mass: 1 });
      physics.addBoxCollider(otherBody, 0.5, 0.5, { restitution: 0, friction: 0 });
      const before = physics.getPosition(other)?.y;
      if (before === undefined) {
        throw new Error("expected the other body");
      }
      let maxAbsY = 0;
      let maxDy = 0;
      let prevY = 2;
      let offenderFinite = true;
      let advanceError: unknown;
      try {
        for (let step = 0; step < BLOWUP_STEPS; step += 1) {
          await handle.advance(1, DT);
          const pose = physics.getPosition(offender);
          const velocity = physics.getLinearVelocity(offender);
          const y = pose?.y;
          if (
            pose === null ||
            y === undefined ||
            !Number.isFinite(pose.x) ||
            !Number.isFinite(y) ||
            velocity === null ||
            !Number.isFinite(velocity.x) ||
            !Number.isFinite(velocity.y)
          ) {
            offenderFinite = false;
            continue;
          }
          maxDy = Math.max(maxDy, Math.abs(y - prevY));
          prevY = y;
          maxAbsY = Math.max(maxAbsY, Math.abs(y));
        }
      } catch (err: unknown) {
        advanceError = err;
      }
      const positionCeiling = 2 + MAX_LINEAR_VELOCITY * BLOWUP_STEPS * DT;
      const endVelocity = physics.getLinearVelocity(offender);
      const endSpeed = endVelocity === null ? undefined : Math.hypot(endVelocity.x, endVelocity.y);
      const after = physics.getPosition(other)?.y;
      expect(seen).toEqual([]);
      expect(advanceError).toBeUndefined();
      expect(offenderFinite).toBe(true);
      expect(maxAbsY).toBeGreaterThan(MEASURED_PEAK_FLOOR);
      expect(maxAbsY).toBeLessThanOrEqual(positionCeiling);
      expect(maxDy).toBeLessThanOrEqual(MAX_LINEAR_VELOCITY * DT);
      expect(endSpeed).toBeLessThanOrEqual(MAX_LINEAR_VELOCITY);
      expect(after).not.toBe(before);
      expect(after !== undefined && Number.isFinite(after)).toBe(true);
      await handle.advance(1, DT);
      expect(seen).toEqual([]);
      expect(physics.getPosition(other)?.y).not.toBe(after);
      expect(handle.bridge.countEntities()).toBe(3);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("a configured cap of 50 slows a body whose speed is 100", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const physics = await startPhysics(handle, 0, 50);
      const id = handle.engine.createEntity();
      const body = physics.addRigidBody(id, "dynamic", 0, 1, { gravityScale: 0, mass: 1 });
      physics.addBoxCollider(body, 0.5, 0.5);
      physics.setLinearVelocity(id, 100, 0);
      await handle.advance(1, DT);
      const velocity = physics.getLinearVelocity(id);
      const speed = velocity === null ? undefined : Math.hypot(velocity.x, velocity.y);
      expect(speed).toBe(50);
    } finally {
      await handle.dispose();
    }
  });

  it("a NaN velocity disables the body with reason non-finite", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: string }> = [];
    const unhook = handle.engine.hooks.hook("physics2d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle, 0);
      const id = handle.engine.createEntity();
      const body = physics.addRigidBody(id, "dynamic", 0, 1, { gravityScale: 0, mass: 1 });
      physics.addBoxCollider(body, 0.5, 0.5);
      physics.setLinearVelocity(id, Number.NaN, 0);
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: id, reason: "non-finite" }]);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("a velocity that would leave the world disables the body with reason velocity", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: string }> = [];
    const unhook = handle.engine.hooks.hook("physics2d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle, 0);
      const id = handle.engine.createEntity();
      const body = physics.addRigidBody(id, "dynamic", 1e7, 0, { gravityScale: 0, mass: 1 });
      physics.addBoxCollider(body, 0.5, 0.5);
      physics.setLinearVelocity(id, 400, 0);
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: id, reason: "velocity" }]);
    } finally {
      unhook();
      await handle.dispose();
    }
  });
});

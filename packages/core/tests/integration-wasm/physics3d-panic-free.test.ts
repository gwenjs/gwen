/**
 * Real physics3d WASM. A diverging body must not abort the instance, and a
 * non-finite query must come back as `PHYSICS3D:INVALID_QUERY`.
 */
import { describe, expect, it } from "vitest";

import { GwenWasmError, type EntityId } from "../../src/index.js";
import "../../../physics3d/src/augment";
import { Physics3DErrorCodes } from "../../../physics3d/src/errors/codes";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const DT = 1 / 60;
const BLOWUP_STEPS = 200;
const MAX_LINEAR_VELOCITY = 400;
/** Next f32 above 1e7. Integers below 2^24 are exact, so this is `next_up`. */
const PAST_WORLD_EXTENT = 1e7 + 1;
/** Measured peak |y| for restitution 1e9 is 1103.37708. A fall from y = 2 stays near 2. */
const MEASURED_PEAK_FLOOR = 1100;
const RESTITUTION_BLOWUP = 1e9;
const BOX = { type: "box" as const, halfX: 0.5, halfY: 0.5, halfZ: 0.5 };

type DisabledReason = "non-finite" | "out-of-bounds" | "velocity";

function errorCode(key: string): unknown {
  if (!Object.hasOwn(Physics3DErrorCodes, key)) return undefined;
  const value: unknown = Reflect.get(Physics3DErrorCodes, key);
  return value;
}

async function startPhysics(
  handle: RealEngineHandle,
  gravityY = -9.81,
  maxLinearVelocity?: number,
): Promise<Physics3DAPI> {
  await handle.engine.use(
    Physics3DPlugin({
      gravity: { x: 0, y: gravityY, z: 0 },
      maxEntities: 32,
      ...(maxLinearVelocity === undefined ? {} : { maxLinearVelocity }),
    }),
  );
  return handle.engine.inject("physics3d");
}

describe("physics3d panic-free", () => {
  it("point/ray query with NaN rejects with PHYSICS3D:INVALID_QUERY", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const physics = await startPhysics(handle, 0);
      const id = handle.engine.createEntity();
      physics.createBody(id, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      physics.addCollider(id, { shape: BOX });
      let rayCode: unknown;
      try {
        physics.castRay({ x: Number.NaN, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
      } catch (err: unknown) {
        rayCode = err instanceof GwenWasmError ? err.code : undefined;
      }
      let pointCode: unknown;
      try {
        physics.projectPoint({ x: Number.NaN, y: 0, z: 0 });
      } catch (err: unknown) {
        pointCode = err instanceof GwenWasmError ? err.code : undefined;
      }
      expect(rayCode).toBe("PHYSICS3D:INVALID_QUERY");
      expect(pointCode).toBe("PHYSICS3D:INVALID_QUERY");
      expect(errorCode("INVALID_QUERY")).toBe("PHYSICS3D:INVALID_QUERY");
      expect(handle.bridge.countEntities()).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("a diverging body is disabled, the hook fires once with its entity and the instance stays usable", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: DisabledReason }> = [];
    const unhook = handle.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle);
      const { engine } = handle;
      const ground = engine.createEntity();
      physics.createBody(ground, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });
      physics.addCollider(ground, {
        shape: { type: "box", halfX: 20, halfY: 0.5, halfZ: 20 },
        restitution: 0,
        friction: 0,
      });
      const offender = engine.createEntity();
      // Restitution 1e9 no longer leaves ±1e7: Rapier 0.36.1 caps speed at 400 m/s.
      // The next f32 past 1e7 is disabled on the first step (out-of-bounds).
      physics.createBody(offender, {
        kind: "dynamic",
        mass: 1,
        initialPosition: { x: PAST_WORLD_EXTENT, y: 2, z: 0 },
      });
      physics.addCollider(offender, { shape: BOX, restitution: 0, friction: 0 });
      const other = engine.createEntity();
      physics.createBody(other, {
        kind: "dynamic",
        mass: 1,
        initialPosition: { x: 40, y: 8, z: 0 },
      });
      physics.addCollider(other, { shape: BOX, restitution: 0, friction: 0 });
      const before = physics.getBodyState(other)?.position.y;
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
        advanceError = err;
      }
      expect(seen).toEqual([{ entity: offender, reason: "out-of-bounds" }]);
      expect(advanceError).toBeUndefined();
      const atDisable = physics.getBodyState(other)?.position.y;
      expect(atDisable).not.toBe(before);
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: offender, reason: "out-of-bounds" }]);
      expect(physics.getBodyState(other)?.position.y).not.toBe(atDisable);
      expect(handle.bridge.countEntities()).toBe(3);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("restitution 1e9 stays enabled and bounded, the hook stays silent and the instance keeps stepping", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: DisabledReason }> = [];
    const unhook = handle.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle);
      const { engine } = handle;
      const ground = engine.createEntity();
      physics.createBody(ground, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });
      physics.addCollider(ground, {
        shape: { type: "box", halfX: 20, halfY: 0.5, halfZ: 20 },
        restitution: RESTITUTION_BLOWUP,
        friction: 0,
      });
      const offender = engine.createEntity();
      physics.createBody(offender, {
        kind: "dynamic",
        mass: 1,
        initialPosition: { x: 0, y: 2, z: 0 },
      });
      physics.addCollider(offender, { shape: BOX, restitution: RESTITUTION_BLOWUP, friction: 0 });
      const other = engine.createEntity();
      physics.createBody(other, {
        kind: "dynamic",
        mass: 1,
        initialPosition: { x: 40, y: 8, z: 0 },
      });
      physics.addCollider(other, { shape: BOX, restitution: 0, friction: 0 });
      const before = physics.getBodyState(other)?.position.y;
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
          const pose = physics.getBodyState(offender);
          const velocity = physics.getLinearVelocity(offender);
          const y = pose?.position.y;
          if (
            pose === undefined ||
            y === undefined ||
            !Number.isFinite(pose.position.x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(pose.position.z) ||
            velocity === undefined ||
            !Number.isFinite(velocity.x) ||
            !Number.isFinite(velocity.y) ||
            !Number.isFinite(velocity.z)
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
      const endSpeed =
        endVelocity === undefined
          ? undefined
          : Math.hypot(endVelocity.x, endVelocity.y, endVelocity.z);
      const after = physics.getBodyState(other)?.position.y;
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
      expect(physics.getBodyState(other)?.position.y).not.toBe(after);
      expect(handle.bridge.countEntities()).toBe(3);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("a configured cap of 50 slows a body whose speed is 100", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const physics = await startPhysics(handle, 0, 50);
      const id = handle.engine.createEntity();
      physics.createBody(id, {
        kind: "dynamic",
        gravityScale: 0,
        mass: 1,
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      physics.addCollider(id, { shape: BOX });
      physics.setLinearVelocity(id, { x: 100, y: 0, z: 0 });
      await handle.advance(1, DT);
      const velocity = physics.getLinearVelocity(id);
      const speed =
        velocity === undefined ? undefined : Math.hypot(velocity.x, velocity.y, velocity.z);
      expect(speed).toBe(50);
    } finally {
      await handle.dispose();
    }
  });

  it("a NaN velocity disables the body with reason non-finite", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: string }> = [];
    const unhook = handle.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle, 0);
      const id = handle.engine.createEntity();
      physics.createBody(id, {
        kind: "dynamic",
        gravityScale: 0,
        mass: 1,
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      physics.addCollider(id, { shape: BOX });
      physics.setLinearVelocity(id, { x: Number.NaN, y: 0, z: 0 });
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: id, reason: "non-finite" }]);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("a velocity that would leave the world disables the body with reason velocity", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const seen: Array<{ entity: EntityId; reason: string }> = [];
    const unhook = handle.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seen.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physics = await startPhysics(handle, 0);
      const id = handle.engine.createEntity();
      physics.createBody(id, {
        kind: "dynamic",
        gravityScale: 0,
        mass: 1,
        initialPosition: { x: 1e7, y: 0, z: 0 },
      });
      physics.addCollider(id, { shape: BOX });
      physics.setLinearVelocity(id, { x: 400, y: 0, z: 0 });
      await handle.advance(1, DT);
      expect(seen).toEqual([{ entity: id, reason: "velocity" }]);
    } finally {
      unhook();
      await handle.dispose();
    }
  });

  it("two engines do not share a disabled body", async () => {
    const handleA = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const handleB = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    const seenA: Array<{ entity: EntityId; reason: string }> = [];
    const seenB: Array<{ entity: EntityId; reason: string }> = [];
    const unhookA = handleA.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seenA.push({ entity: payload.entity, reason: payload.reason });
    });
    const unhookB = handleB.engine.hooks.hook("physics3d:body-disabled", (payload) => {
      seenB.push({ entity: payload.entity, reason: payload.reason });
    });
    try {
      const physicsA = await startPhysics(handleA, 0);
      const physicsB = await startPhysics(handleB, 0);
      const idA = handleA.engine.createEntity();
      physicsA.createBody(idA, {
        kind: "dynamic",
        gravityScale: 0,
        mass: 1,
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      physicsA.addCollider(idA, { shape: BOX });
      physicsA.setLinearVelocity(idA, { x: Number.NaN, y: 0, z: 0 });
      const idB = handleB.engine.createEntity();
      physicsB.createBody(idB, {
        kind: "dynamic",
        gravityScale: 0,
        mass: 1,
        initialPosition: { x: 0, y: 1, z: 0 },
      });
      physicsB.addCollider(idB, { shape: BOX });
      await handleA.advance(1, DT);
      await handleB.advance(1, DT);
      expect(seenA).toEqual([{ entity: idA, reason: "non-finite" }]);
      expect(seenB).toEqual([]);
      expect(physicsB.getBodyState(idB)?.position.x).toBe(0);
    } finally {
      unhookA();
      unhookB();
      try {
        await handleA.dispose();
      } finally {
        await handleB.dispose();
      }
    }
  });
});

/**
 * A dynamic body created with no damping option keeps the velocity it was given.
 */
import { describe, expect, it } from "vitest";

import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "../../src/engine/engine-types.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

async function openPhysics2D(handle: RealEngineHandle): Promise<Physics2DAPI> {
  await handle.engine.use(Physics2DPlugin({ gravity: 0, maxEntities: 32 }));
  return handle.engine.inject("physics2d");
}

async function openPhysics3D(handle: RealEngineHandle): Promise<Physics3DAPI> {
  await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 }, maxEntities: 32 }));
  return handle.engine.inject("physics3d");
}

describe("2D damping default", () => {
  it("keeps the launch speed of two bodies created with no damping option", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics2D(handle);
      const { engine, advance } = handle;
      const resting = engine.createEntity();
      const forward = engine.createEntity();
      const backward = engine.createEntity();
      physics.addRigidBody(resting, "dynamic", 0, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: 0, vy: 0 },
      });
      physics.addRigidBody(forward, "dynamic", 4, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: 10, vy: 0 },
      });
      physics.addRigidBody(backward, "dynamic", 8, 0, {
        gravityScale: 0,
        mass: 1,
        initialVelocity: { vx: -4, vy: 0 },
      });
      await advance(1, 1 / 60);
      await advance(1, 1 / 60);
      const stopped = physics.getLinearVelocity(resting);
      const ahead = physics.getLinearVelocity(forward);
      const behind = physics.getLinearVelocity(backward);
      expect(stopped).toEqual({ x: 0, y: 0 });
      expect(ahead?.x).toBeCloseTo(10, 3);
      expect(ahead?.y).toBeCloseTo(0, 3);
      expect(behind?.x).toBeCloseTo(-4, 3);
      expect(behind?.y).toBeCloseTo(0, 3);
    } finally {
      await handle.dispose();
    }
  });
});

describe("3D damping default", () => {
  it("keeps the launch speed of two 3D bodies created with no damping option", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32, physicsHz: 60 });
    try {
      const physics = await openPhysics3D(handle);
      const { engine, advance } = handle;
      const resting = engine.createEntity();
      const forward = engine.createEntity();
      const backward = engine.createEntity();
      physics.createBody(resting, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 0, y: 0, z: 0 },
        initialLinearVelocity: { x: 0, y: 0, z: 0 },
      });
      physics.createBody(forward, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 4, y: 0, z: 0 },
        initialLinearVelocity: { x: 10, y: 0, z: 0 },
      });
      physics.createBody(backward, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 8, y: 0, z: 0 },
        initialLinearVelocity: { x: -4, y: 0, z: 0 },
      });
      await advance(1, 1 / 60);
      await advance(1, 1 / 60);
      const stopped = physics.getLinearVelocity(resting);
      const ahead = physics.getLinearVelocity(forward);
      const behind = physics.getLinearVelocity(backward);
      expect(stopped).toEqual({ x: 0, y: 0, z: 0 });
      expect(ahead?.x).toBeCloseTo(10, 3);
      expect(ahead?.y).toBeCloseTo(0, 3);
      expect(ahead?.z).toBeCloseTo(0, 3);
      expect(behind?.x).toBeCloseTo(-4, 3);
      expect(behind?.y).toBeCloseTo(0, 3);
      expect(behind?.z).toBeCloseTo(0, 3);
    } finally {
      await handle.dispose();
    }
  });
});

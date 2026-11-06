/**
 * Determinism oracle for the shared physics layer (P-58-0, D-58-a).
 * Positions and event counts are literals captured on this base.
 * Do not refresh them with --update.
 */

import { describe, expect, it } from "vitest";
import { unpackEntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

const STEPS = 120;
const DT = 1 / 60;

describe("P-58-0 physics determinism", () => {
  it("physics2d positions after 120 steps match the snapshot", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    const { engine, advance } = handle;
    try {
      await engine.use(Physics2DPlugin({ gravity: -9.81 }));
      let collisions = 0;
      let started = 0;
      let sensors = 0;
      engine.hooks.hook("physics:collision", (contacts) => {
        for (const contact of contacts) {
          collisions += 1;
          if (contact.started) started += 1;
        }
      });
      engine.hooks.hook("physics:sensor:changed", () => {
        sensors += 1;
      });
      const physics = engine.inject("physics2d");
      const ground = engine.createEntity();
      physics.addBoxCollider(physics.addRigidBody(ground, "fixed", 0, -1), 2, 0.5);
      const dynamic = engine.createEntity();
      physics.addBoxCollider(physics.addRigidBody(dynamic, "dynamic", 0, 4), 0.5, 0.5);
      const kinematic = engine.createEntity();
      physics.addRigidBody(kinematic, "kinematic", 2, 1);
      const sensor = engine.createEntity();
      await engine.hooks.callHook("prefab:instantiate", sensor, {
        physics: {
          bodyType: "fixed",
          colliders: [{ shape: "box", hw: 0.5, hh: 0.5, isSensor: true, colliderId: 1 }],
        },
      });
      const slot = unpackEntityId(kinematic).index;
      for (let step = 0; step < STEPS; step += 1) {
        physics.bulkStepKinematics(
          new Uint32Array([slot]),
          new Float32Array([1]),
          new Float32Array([0]),
          DT,
        );
        await advance(1, DT);
      }
      const dynamicPos = physics.getPosition(dynamic);
      const kinematicPos = physics.getPosition(kinematic);
      if (dynamicPos === null || kinematicPos === null) {
        throw new Error("missing physics2d position");
      }
      expect(dynamicPos.x).toBeCloseTo(0.001431871671229601, 5);
      expect(dynamicPos.y).toBeCloseTo(-0.00008621939196018502, 5);
      expect(dynamicPos.rotation).toBeCloseTo(4.6156216626513924e-8, 5);
      expect(kinematicPos.x).toBeCloseTo(3.999998092651367, 5);
      expect(kinematicPos.y).toBeCloseTo(1, 5);
      expect(kinematicPos.rotation).toBeCloseTo(0, 5);
      expect(collisions).toBe(2);
      expect(started).toBe(2);
      expect(sensors).toBe(1);
    } finally {
      await handle.dispose();
    }
  }, 60_000);

  it("physics3d positions after 120 steps match the snapshot", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    const { engine, advance } = handle;
    try {
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: -9.81, z: 0 } }));
      let collisions = 0;
      let started = 0;
      let sensors = 0;
      engine.hooks.hook("physics3d:collision", (contacts) => {
        for (const contact of contacts) {
          collisions += 1;
          if (contact.started) started += 1;
        }
      });
      engine.hooks.hook("physics3d:sensor:changed", () => {
        sensors += 1;
      });
      const physics = engine.inject("physics3d");
      const ground = engine.createEntity();
      physics.createBody(ground, { kind: "fixed", initialPosition: { x: 0, y: -1, z: 0 } });
      const groundAdded = physics.addCollider(ground, {
        shape: { type: "box", halfX: 2, halfY: 0.5, halfZ: 2 },
      });
      const dynamic = engine.createEntity();
      physics.createBody(dynamic, { kind: "dynamic", initialPosition: { x: 0, y: 4, z: 0 } });
      const dynamicAdded = physics.addCollider(dynamic, {
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      const kinematic = engine.createEntity();
      physics.createBody(kinematic, {
        kind: "kinematic",
        initialPosition: { x: 2, y: 1, z: 0 },
      });
      const sensor = engine.createEntity();
      physics.createBody(sensor, { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } });
      const sensorAdded = physics.addCollider(sensor, {
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        isSensor: true,
        colliderId: 1,
      });
      if (!groundAdded || !dynamicAdded || !sensorAdded) {
        throw new Error("physics3d collider was not added");
      }
      const slot = unpackEntityId(kinematic).index;
      for (let step = 0; step < STEPS; step += 1) {
        physics.bulkStepKinematics(
          new Uint32Array([slot]),
          new Float32Array([1]),
          new Float32Array([0]),
          new Float32Array([0]),
          DT,
        );
        await advance(1, DT);
      }
      const dynamicState = physics.getBodyState(dynamic);
      const kinematicState = physics.getBodyState(kinematic);
      if (dynamicState === undefined || kinematicState === undefined) {
        throw new Error("missing physics3d body");
      }
      expect(dynamicState.position.x).toBeCloseTo(0.013756344094872475, 5);
      expect(dynamicState.position.y).toBeCloseTo(-0.00006897749699419364, 5);
      expect(dynamicState.position.z).toBeCloseTo(0.026781994849443436, 5);
      expect(kinematicState.position.x).toBeCloseTo(3.999998092651367, 5);
      expect(kinematicState.position.y).toBeCloseTo(1, 5);
      expect(kinematicState.position.z).toBeCloseTo(0, 5);
      expect(collisions).toBe(2);
      expect(started).toBe(2);
      expect(sensors).toBe(3);
    } finally {
      await handle.dispose();
    }
  }, 60_000);
});

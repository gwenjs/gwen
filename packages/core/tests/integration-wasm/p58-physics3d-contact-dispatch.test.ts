/**
 * One 3D frame records sensor enter, the sensor hook, the collision hook,
 * onContact and the prefab onCollision.
 * The base plugin runs collision, then onContact, then the sensor hook,
 * then onSensorEnter, then onCollision
 * (packages/physics3d/src/plugin/index.ts:518-581).
 * Inside that sensor transition the hook runs before onSensorEnter
 * (packages/physics3d/src/plugin/index.ts:559-569).
 */
import { describe, expect, it } from "vitest";
import { createRealEngine } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { onContact } from "../../../physics3d/src/composables/on-contact.js";
import { onSensorEnter } from "../../../physics3d/src/composables/on-sensor.js";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics3d: Physics3DAPI;
  }
}

const SENSOR_ID = 7;
/** Stored as u16::MAX, so the plugin skips that side (packages/physics3d/src/plugin/constants.ts:13). */
const ABSENT_COLLIDER_ID = 0xffff;
const DT = 1 / 60;
const FRAMES = 8;

type Order = string[];

describe("physics3d contact dispatch order", () => {
  it("runs sensor transitions before physics:collision and onContact", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      const order: Order = [];
      engine.hooks.hook("physics:sensor:changed", () => {
        order.push("sensor-changed");
      });
      engine.hooks.hook("physics:collision", () => {
        order.push("collision");
      });
      engine.run(() => {
        onSensorEnter(SENSOR_ID, () => {
          order.push("sensor-enter");
        });
        onContact(() => {
          order.push("contact");
        });
      });
      const sensor = engine.createEntity();
      const solid = engine.createEntity();
      await engine.hooks.callHook("prefab:instantiate", sensor, {
        physics3d: {
          body: { kind: "fixed", initialPosition: { x: 0, y: 0, z: 0 } },
          onCollision: () => {
            order.push("on-collision");
          },
        },
      });
      const sensorAdded = physics.addCollider(sensor, {
        colliderId: SENSOR_ID,
        isSensor: true,
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      physics.createBody(solid, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      const solidAdded = physics.addCollider(solid, {
        colliderId: ABSENT_COLLIDER_ID,
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      expect(sensorAdded).toBe(true);
      expect(solidAdded).toBe(true);
      for (let frame = 0; frame < FRAMES; frame += 1) {
        order.length = 0;
        await advance(1, DT);
        if (order.includes("sensor-enter") && order.includes("collision")) break;
      }
      expect(order).toEqual([
        "sensor-enter",
        "sensor-changed",
        "collision",
        "contact",
        "on-collision",
      ]);
    } finally {
      await handle.dispose();
    }
  });

  it("runs onSensorEnter before physics:sensor:changed inside one transition", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      const order: Order = [];
      engine.hooks.hook("physics:sensor:changed", () => {
        order.push("sensor-changed");
      });
      engine.run(() => {
        onSensorEnter(SENSOR_ID, () => {
          order.push("sensor-enter");
        });
      });
      const sensor = engine.createEntity();
      const solid = engine.createEntity();
      physics.createBody(sensor, {
        kind: "fixed",
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      const sensorAdded = physics.addCollider(sensor, {
        colliderId: SENSOR_ID,
        isSensor: true,
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      physics.createBody(solid, {
        kind: "dynamic",
        gravityScale: 0,
        initialPosition: { x: 0, y: 0, z: 0 },
      });
      const solidAdded = physics.addCollider(solid, {
        colliderId: ABSENT_COLLIDER_ID,
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      expect(sensorAdded).toBe(true);
      expect(solidAdded).toBe(true);
      for (let frame = 0; frame < FRAMES; frame += 1) {
        order.length = 0;
        await advance(1, DT);
        if (order.includes("sensor-enter") && order.includes("sensor-changed")) break;
      }
      expect(order).toEqual(["sensor-enter", "sensor-changed"]);
    } finally {
      await handle.dispose();
    }
  });
});

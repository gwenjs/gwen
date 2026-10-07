/**
 * Contact payload and per-entity sensor callbacks on a real WASM engine.
 */
import { describe, expect, it } from "vitest";
import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { defineActor, definePrefab, useEntityId } from "../../src/actor/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { onContact } from "../../../physics2d/src/composables/on-contact.js";
import {
  _dispatchSensorEnter as dispatchSensor2d,
  onSensorEnter as onSensorEnter2d,
} from "../../../physics2d/src/composables/on-sensor.js";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import {
  _dispatchSensorEnter as dispatchSensor3d,
  onSensorEnter as onSensorEnter3d,
} from "../../../physics3d/src/composables/on-sensor.js";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "../../src/engine/gwen-engine.js" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
    physics3d: Physics3DAPI;
  }
}

const Position = defineComponent({
  name: "P154Pos",
  schema: { x: Types.f32, y: Types.f32 },
});
const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("real engine component ids", () => {
  it("does not grow the type count when the same name is registered again", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const engine = handle.engine;
      const first = engine.getOrRegisterComponent("Position");
      defineComponent({ name: "Position", schema: { x: Types.f32, y: Types.f32 } });
      const again = engine.getOrRegisterComponent("Position");
      engine.getOrRegisterComponent("Velocity");
      expect(again).toBe(first);
      expect(engine.registeredComponentTypes().size).toBe(2);
      expect(engine.registeredComponentTypes().get("Position")).toBe(first);
    } finally {
      await handle.dispose();
    }
  });
});

describe("physics2d contact payload", () => {
  it("reports started from the world instead of a zeroed contact point", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const physics = engine.inject("physics2d");
      const seen: { started?: boolean }[] = [];
      const left = engine.createEntity();
      const right = engine.createEntity();
      engine.run(() => {
        onContact((event) => {
          seen.push(event);
        }, left);
      });
      physics.addBoxCollider(physics.addRigidBody(left, "dynamic", 0, 0), 0.5, 0.5);
      physics.addBoxCollider(physics.addRigidBody(right, "dynamic", 0.2, 0), 0.5, 0.5);
      await advance(5, 1 / 60);
      expect(seen.map((event) => event.started)).toContain(true);
      expect(seen.every((event) => event.started === true || event.started === false)).toBe(true);
      expect(Object.hasOwn(seen[0] ?? {}, "contactX")).toBe(false);
    } finally {
      await handle.dispose();
    }
  });
});

describe("sensor callbacks survive the other entity", () => {
  it("keeps the 2d callback after the other sensor entity is destroyed", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const hits = new Map<EntityId, number>();
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onSensorEnter2d(0, () => {
          hits.set(id, (hits.get(id) ?? 0) + 1);
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      const idB = engine.run(() => Actor._plugin.spawn());
      const sensor = {
        physics: {
          bodyType: "static" as const,
          colliders: [{ shape: "box" as const, hw: 0.5, hh: 0.5, isSensor: true, colliderId: 0 }],
        },
      };
      await engine.hooks.callHook("prefab:instantiate", idA, sensor);
      await engine.hooks.callHook("prefab:instantiate", idB, sensor);
      engine.destroyEntity(idA);
      engine.run(() => {
        dispatchSensor2d(0, idB);
      });
      expect(hits.get(idB)).toBe(1);
      expect(hits.get(idA) ?? 0).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("keeps the 3d callback after the other sensor entity is destroyed", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      const hits = new Map<EntityId, number>();
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onSensorEnter3d(0, () => {
          hits.set(id, (hits.get(id) ?? 0) + 1);
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      const idB = engine.run(() => Actor._plugin.spawn());
      const body = (id: EntityId): void => {
        physics.createBody(id, { kind: "static", initialPosition: { x: 0, y: 0, z: 0 } });
        physics.addCollider(id, {
          colliderId: 0,
          isSensor: true,
          shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
        });
      };
      body(idA);
      body(idB);
      engine.destroyEntity(idA);
      engine.run(() => {
        dispatchSensor3d(0, idB);
      });
      expect(hits.get(idB)).toBe(1);
      expect(hits.get(idA) ?? 0).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("removes the 2d callback of the destroyed entity", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const hits = new Map<EntityId, number>();
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onSensorEnter2d(0, () => {
          hits.set(id, (hits.get(id) ?? 0) + 1);
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      const sensor = {
        physics: {
          bodyType: "static" as const,
          colliders: [{ shape: "box" as const, hw: 0.5, hh: 0.5, isSensor: true, colliderId: 0 }],
        },
      };
      await engine.hooks.callHook("prefab:instantiate", idA, sensor);
      engine.run(() => {
        dispatchSensor2d(0, idA);
      });
      const before = hits.get(idA) ?? 0;
      engine.destroyEntity(idA);
      engine.run(() => {
        dispatchSensor2d(0, idA);
      });
      expect(before).toBe(1);
      expect(hits.get(idA) ?? 0).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("removes the 3d callback of the destroyed entity", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32 });
    try {
      const { engine } = handle;
      await engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } }));
      const physics = engine.inject("physics3d");
      const hits = new Map<EntityId, number>();
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onSensorEnter3d(0, () => {
          hits.set(id, (hits.get(id) ?? 0) + 1);
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      physics.createBody(idA, { kind: "static", initialPosition: { x: 0, y: 0, z: 0 } });
      physics.addCollider(idA, {
        colliderId: 0,
        isSensor: true,
        shape: { type: "box", halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
      });
      engine.run(() => {
        dispatchSensor3d(0, idA);
      });
      const before = hits.get(idA) ?? 0;
      engine.destroyEntity(idA);
      engine.run(() => {
        dispatchSensor3d(0, idA);
      });
      expect(before).toBe(1);
      expect(hits.get(idA) ?? 0).toBe(1);
    } finally {
      await handle.dispose();
    }
  });
});

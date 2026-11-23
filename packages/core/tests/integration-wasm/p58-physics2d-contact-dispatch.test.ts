/**
 * Tilemap contacts stay out of physics:collision.
 * A callback that destroys its actor does not skip the next callback.
 */
import { describe, expect, it } from "vitest";
import { createEntityId, type EntityId } from "@gwenjs/schema";
import { defineComponent, Types } from "../../src/index.js";
import { defineActor, definePrefab, useEntityId } from "../../src/actor/index.js";
import { createRealEngine } from "./harness.js";
import {
  createContactRegistry,
  createSensorRegistry,
  onContact as coreOnContact,
  onSensorEnter as coreOnSensorEnter,
} from "@gwenjs/physics-core";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { onContact } from "../../../physics2d/src/composables/on-contact.js";
import { onSensorEnter } from "../../../physics2d/src/composables/on-sensor.js";
import {
  tilemapChunkIdFromKey,
  tilemapPseudoEntityFromChunkId,
} from "../../../physics2d/src/utils";
import type { CollisionContact, Physics2DAPI } from "../../../physics2d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }
}

const Position = defineComponent({
  name: "P58Round4Pos",
  schema: { x: Types.f32, y: Types.f32 },
});
const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

function slotsOf(event: object): number[] {
  const slots: number[] = [];
  if ("slotA" in event && typeof event.slotA === "number") slots.push(event.slotA);
  if ("slotB" in event && typeof event.slotB === "number") slots.push(event.slotB);
  return slots;
}

describe("tilemap chunk contacts", () => {
  it("a body that touches a loaded chunk leaves the chunk pseudo id out of physics:collision", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 }, eventMode: "hybrid" }));
      const physics = engine.inject("physics2d");
      const contacts: CollisionContact[] = [];
      const rawSlots: number[] = [];
      engine.hooks.hook("physics:collision", (list) => {
        contacts.push(...list);
      });
      engine.hooks.hook("physics:collision:batch", (batch) => {
        for (const event of batch.events) rawSlots.push(...slotsOf(event));
      });
      const chunk = {
        key: "0,0",
        checksum: "contact-dispatch",
        chunkX: 0,
        chunkY: 0,
        rects: [],
        colliders: [{ shape: "box" as const, hw: 50, hh: 50 }],
      };
      const pseudoSlot = tilemapPseudoEntityFromChunkId(tilemapChunkIdFromKey(chunk.key));
      const pseudoId = createEntityId(pseudoSlot, 0);
      physics.loadTilemapPhysicsChunk(chunk, 0, 0);
      const body = engine.createEntity();
      physics.addRigidBody(body, "dynamic", 0, 0, { gravityScale: 0 });
      physics.addBoxCollider(body, 0.5, 0.5);
      await advance(8, 1 / 60);
      expect(rawSlots).toContain(pseudoSlot);
      expect(
        contacts.some((contact) => contact.entityA === pseudoId || contact.entityB === pseudoId),
      ).toBe(false);
    } finally {
      await handle.dispose();
    }
  });
});

describe("a destroy inside a 2D callback still reaches the other listener", () => {
  it("destroying actor A from its 2D onContact still delivers that contact to physics-core onContact for B", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 } }));
      const physics = engine.inject("physics2d");
      const seen: CollisionContact[] = [];
      let presentDuringDestroy = false;
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onContact(() => {
          engine.destroyEntity(id);
          const entries = createContactRegistry().peek(engine)?.entries ?? [];
          presentDuringDestroy = entries.some((entry) => entry.entityId === id);
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      const idB = engine.createEntity();
      engine.run(() => {
        coreOnContact((event) => {
          seen.push(event);
        }, idB);
      });
      physics.addRigidBody(idA, "dynamic", 0, 0, { gravityScale: 0 });
      physics.addBoxCollider(idA, 0.5, 0.5);
      physics.addRigidBody(idB, "dynamic", 0.2, 0, { gravityScale: 0 });
      physics.addBoxCollider(idB, 0.5, 0.5);
      await advance(5, 1 / 60);
      expect(presentDuringDestroy).toBe(true);
      expect(seen.some((event) => event.entityA === idA || event.entityB === idA)).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  it("destroying actor A from its 2D onSensorEnter still delivers that enter to physics-core onSensorEnter for B", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32 });
    try {
      const { engine, advance } = handle;
      await engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 } }));
      const physics = engine.inject("physics2d");
      const seen: EntityId[] = [];
      let enterCountDuringDestroy = 0;
      const Actor = defineActor(Prefab, () => {
        const id = useEntityId();
        onSensorEnter(0, () => {
          engine.destroyEntity(id);
          const entries = createSensorRegistry().peek(engine)?.entries ?? [];
          enterCountDuringDestroy = entries.filter(
            (entry) => entry.sensorId === 0 && entry.phase === "enter",
          ).length;
        });
      });
      await engine.use(Actor._plugin);
      const idA = engine.run(() => Actor._plugin.spawn());
      const idB = engine.createEntity();
      engine.run(() => {
        coreOnSensorEnter(0, (id) => {
          seen.push(id);
        });
      });
      await engine.hooks.callHook("prefab:instantiate", idA, {
        physics2d: {
          bodyType: "dynamic" as const,
          gravityScale: 0,
          colliders: [{ shape: "box" as const, hw: 16, hh: 16, isSensor: true, colliderId: 0 }],
        },
      });
      physics.addRigidBody(idB, "dynamic", 0, 0, { gravityScale: 0 });
      physics.addBoxCollider(idB, 0.5, 0.5);
      await advance(8, 1 / 60);
      expect(enterCountDuringDestroy).toBe(2);
      expect(seen).toContain(idA);
    } finally {
      await handle.dispose();
    }
  });
});

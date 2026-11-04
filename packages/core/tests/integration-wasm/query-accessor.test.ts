import { describe, expect, it } from "vitest";

import { defineComponent, Types } from "../../src/schema";
import type { EntityId } from "../../src/types/entity.js";
import { createRealEngine } from "./harness.js";

const Position = defineComponent({
  name: "QueryAccessorPosition",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "QueryAccessorVelocity",
  schema: { vx: Types.f32, vy: Types.f32 },
});

describe("real WASM query accessor", () => {
  it("get(def) is defined for every queried component after spawn and despawn", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 128 });
    try {
      const { engine } = handle;
      const ids = [];
      for (let i = 0; i < 8; i += 1) {
        const id = engine.createEntity();
        engine.addComponent(id, Position, { x: i, y: i + 1 });
        engine.addComponent(id, Velocity, { vx: 1, vy: 2 });
        ids.push(id);
      }

      const query = engine.createLiveQuery([Position, Velocity]);
      const seen = new Set<bigint>();
      for (const entity of query) {
        const pos = entity.get(Position);
        const vel = entity.get(Velocity);
        expect(pos).toBeDefined();
        expect(vel).toBeDefined();
        expect(typeof pos.x).toBe("number");
        expect(typeof vel.vx).toBe("number");
        seen.add(entity.id);
      }
      expect(seen.size).toBe(8);

      const removedA = ids[0];
      const removedB = ids[1];
      if (removedA === undefined || removedB === undefined) {
        throw new Error("expected spawned ids");
      }
      engine.destroyEntity(removedA);
      engine.destroyEntity(removedB);
      const extra = engine.createEntity();
      engine.addComponent(extra, Position, { x: 9, y: 9 });
      engine.addComponent(extra, Velocity, { vx: 3, vy: 4 });

      let count = 0;
      for (const entity of query) {
        expect(entity.get(Position)).toBeDefined();
        expect(entity.get(Velocity)).toBeDefined();
        expect(entity.id).not.toBe(removedA);
        expect(entity.id).not.toBe(removedB);
        count += 1;
      }
      expect(count).toBe(7);
    } finally {
      await handle.dispose();
    }
  });

  it("every yielded entity returns a defined value for each queried def across spawn/despawn churn", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 1024 });
    try {
      const { engine } = handle;
      const alive = new Set<EntityId>();
      const spawn = (index: number): EntityId => {
        const id = engine.createEntity();
        engine.addComponent(id, Position, { x: index, y: index + 1 });
        engine.addComponent(id, Velocity, { vx: index, vy: index + 2 });
        alive.add(id);
        return id;
      };

      const initial: EntityId[] = [];
      for (let i = 0; i < 500; i += 1) initial.push(spawn(i));
      initial.forEach((id, index) => {
        if (index % 3 !== 0) return;
        engine.destroyEntity(id);
        alive.delete(id);
      });

      const query = engine.createQuery([Position, Velocity]);
      let spawned = 500;
      for (let frame = 0; frame < 10; frame += 1) {
        const victim = alive.values().next().value;
        if (victim === undefined) throw new Error("expected a live entity to destroy");
        engine.destroyEntity(victim);
        alive.delete(victim);
        for (let i = 0; i < 5; i += 1) {
          spawn(spawned);
          spawned += 1;
        }
        await handle.advance(1, 1 / 60);

        const seen = new Set<EntityId>();
        for (const entity of query.each()) {
          const pos = entity.get(Position);
          const vel = entity.get(Velocity);
          expect(pos, `frame ${frame} entity ${entity.id} Position`).toBeDefined();
          expect(vel, `frame ${frame} entity ${entity.id} Velocity`).toBeDefined();
          seen.add(entity.id);
        }
        expect(seen.size).toBe(alive.size);
        expect(seen).toEqual(alive);
      }
    } finally {
      await handle.dispose();
    }
  });
});

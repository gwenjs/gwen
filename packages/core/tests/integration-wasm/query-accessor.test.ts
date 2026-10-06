import { describe, expect, it } from "vitest";

import { defineComponent, Types } from "../../src/schema";
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
      await handle.engine.stop();
    }
  });
});

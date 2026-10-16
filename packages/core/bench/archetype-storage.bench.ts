/**
 * Engine storage bench for 10 000 entities with Position and Velocity.
 * Uses only the public engine API, so the same file runs on the TS map path and on WASM rows.
 *
 * Run:
 *   pnpm --filter @gwenjs/core exec vitest bench --run bench/archetype-storage.bench.ts
 */

import { afterAll, bench, describe } from "vitest";
import { createEngine } from "../src/index";
import { defineComponent, Types } from "../src/schema";
import type { EntityId } from "../src/types/entity";

const COUNT = 10_000;

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { vx: Types.f32, vy: Types.f32 },
  defaults: { vx: 0, vy: 0 },
});

const SAMPLE = { time: 200, iterations: 5, warmupTime: 50, warmupIterations: 2 };

// Benchmark mode does not run beforeAll. Build the engine before bench().
const engine = await createEngine({ maxEntities: COUNT });
const ids: EntityId[] = [];
for (let i = 0; i < COUNT; i++) {
  const id = engine.createEntity();
  engine.addComponent(id, Position, { x: i, y: 0 });
  engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
  ids.push(id);
}
const query = engine.createLiveQuery([Position, Velocity]);

afterAll(async () => {
  await engine.stop();
});

describe("archetype storage — 10 000 [Position, Velocity]", () => {
  bench(
    "chunk iteration",
    () => {
      let sum = 0;
      for (const entity of query) {
        sum += entity.get(Position).x;
      }
      return sum;
    },
    SAMPLE,
  );

  bench(
    "per-entity get/add",
    () => {
      let sum = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const pos = engine.getComponent(id, Position);
        const next = (pos?.x ?? 0) + 1;
        engine.addComponent(id, Position, { x: next, y: pos?.y ?? 0 });
        sum += next;
      }
      return sum;
    },
    SAMPLE,
  );

  bench(
    "add/remove toggle",
    () => {
      const id = ids[0]!;
      engine.removeComponent(id, Velocity);
      engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
    },
    SAMPLE,
  );
});

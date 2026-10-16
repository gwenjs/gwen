/**
 * Benchmark: engine entity and component operations.
 *
 * Run:
 *   pnpm --filter @gwenjs/core bench:ecs
 */

import { afterAll, bench, beforeAll, describe } from "vitest";
import { createEngine } from "../src/index";
import type { GwenEngine } from "../src/engine/engine-types";
import { defineComponent, Types } from "../src/schema";
import type { EntityId } from "../src/types/entity";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const ONCE = { time: 0, iterations: 3, warmupIterations: 1, warmupTime: 0 };

describe("engine entity and component operations", () => {
  let engine: GwenEngine;

  beforeAll(async () => {
    engine = await createEngine({ maxEntities: 10_000 });
  });

  afterAll(async () => {
    await engine.stop();
  });

  bench(
    "create + destroy — 1 000 entities",
    () => {
      const ids: EntityId[] = [];
      for (let i = 0; i < 1_000; i++) ids.push(engine.createEntity());
      for (const id of ids) engine.destroyEntity(id);
    },
    ONCE,
  );

  bench(
    "isAlive — 10 000 checks",
    () => {
      const id = engine.createEntity();
      for (let i = 0; i < 10_000; i++) engine.isAlive(id);
      engine.destroyEntity(id);
    },
    ONCE,
  );

  bench(
    "add + get — 1 000 entities",
    () => {
      const ids: EntityId[] = [];
      for (let i = 0; i < 1_000; i++) {
        const id = engine.createEntity();
        engine.addComponent(id, Position, { x: i, y: 0 });
        ids.push(id);
      }
      let sum = 0;
      for (const id of ids) sum += engine.getComponent(id, Position)?.x ?? 0;
      for (const id of ids) engine.destroyEntity(id);
      return sum;
    },
    ONCE,
  );

  bench(
    "live query — 1 000 entities",
    () => {
      const ids: EntityId[] = [];
      for (let i = 0; i < 1_000; i++) {
        const id = engine.createEntity();
        engine.addComponent(id, Position, { x: i, y: 0 });
        ids.push(id);
      }
      const query = engine.createLiveQuery([Position]);
      let sum = 0;
      for (const entity of query) sum += entity.get(Position).x;
      for (const id of ids) engine.destroyEntity(id);
      return sum;
    },
    ONCE,
  );
});

/**
 * Benchmark: createLiveQuery iteration.
 *
 * Run:
 *   pnpm --filter @gwenjs/core bench:query
 */

import { afterAll, bench, beforeAll, describe } from "vitest";
import { createEngine } from "../src/index";
import type { GwenEngine } from "../src/engine/engine-types";
import { defineComponent, Types } from "../src/schema";

const Position = defineComponent({ name: "Position", schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: "Velocity", schema: { vx: Types.f32, vy: Types.f32 } });
const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32 },
});

const SAMPLE = { time: 100, iterations: 3, warmupTime: 20, warmupIterations: 1 };

async function fill(count: number, withHealth: "all" | "half" | "none"): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: count });
  for (let i = 0; i < count; i++) {
    const id = engine.createEntity();
    engine.addComponent(id, Position, { x: i, y: 0 });
    if (withHealth !== "none") engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
    if (withHealth === "all" || (withHealth === "half" && i % 2 === 0)) {
      engine.addComponent(id, Health, { current: 100, max: 100 });
    }
  }
  return engine;
}

describe("Query iteration — engine createLiveQuery", () => {
  const engines: GwenEngine[] = [];
  let one: GwenEngine;
  let five: GwenEngine;
  let ten: GwenEngine;
  let multi: GwenEngine;
  let half: GwenEngine;

  beforeAll(async () => {
    one = await fill(1_000, "none");
    five = await fill(5_000, "none");
    ten = await fill(10_000, "none");
    multi = await fill(1_000, "all");
    half = await fill(1_000, "half");
    engines.push(one, five, ten, multi, half);
  });

  afterAll(async () => {
    for (const engine of engines) await engine.stop();
  });

  bench(
    "1 000 entities, 1 component",
    () => {
      let sum = 0;
      for (const entity of one.createLiveQuery([Position])) sum += entity.get(Position).x;
      return sum;
    },
    SAMPLE,
  );

  bench(
    "5 000 entities, 1 component",
    () => {
      let sum = 0;
      for (const entity of five.createLiveQuery([Position])) sum += entity.get(Position).x;
      return sum;
    },
    SAMPLE,
  );

  bench(
    "10 000 entities, 1 component",
    () => {
      let sum = 0;
      for (const entity of ten.createLiveQuery([Position])) sum += entity.get(Position).x;
      return sum;
    },
    SAMPLE,
  );

  bench(
    "1 000 entities, 3 components",
    () => {
      let count = 0;
      for (const _entity of multi.createLiveQuery([Position, Velocity, Health])) count += 1;
      return count;
    },
    SAMPLE,
  );

  bench(
    "1 000 entities, 3 components, half match",
    () => {
      let count = 0;
      for (const _entity of half.createLiveQuery([Position, Velocity, Health])) count += 1;
      return count;
    },
    SAMPLE,
  );
});

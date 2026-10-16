/**
 * Benchmark: one movement frame and one health frame through the engine.
 *
 * Run:
 *   pnpm --filter @gwenjs/core bench:simulation
 */

import { afterAll, bench, beforeAll, describe } from "vitest";
import { createEngine } from "../src/index";
import type { GwenEngine } from "../src/engine/engine-types";
import { defineComponent, Types } from "../src/schema";

const DT = 1 / 60;

const Position = defineComponent({ name: "Position", schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: "Velocity", schema: { vx: Types.f32, vy: Types.f32 } });
const Health = defineComponent({
  name: "Health",
  schema: { current: Types.f32, max: Types.f32, regenRate: Types.f32 },
});

const ONCE = { time: 0, iterations: 1, warmupIterations: 1, warmupTime: 0 };

async function world(count: number, sparse: boolean): Promise<GwenEngine> {
  const engine = await createEngine({ maxEntities: count });
  for (let i = 0; i < count; i++) {
    const id = engine.createEntity();
    engine.addComponent(id, Position, { x: i, y: 0 });
    if (!sparse || i % 10 === 0) {
      engine.addComponent(id, Velocity, { vx: 1, vy: 0.5 });
      engine.addComponent(id, Health, { current: 80, max: 100, regenRate: 1 });
    }
  }
  return engine;
}

function move(engine: GwenEngine): void {
  for (const entity of engine.createLiveQuery([Position, Velocity])) {
    const pos = entity.get(Position);
    const vel = entity.get(Velocity);
    engine.addComponent(entity.id, Position, {
      x: pos.x + vel.vx * DT,
      y: pos.y + vel.vy * DT,
    });
  }
}

function heal(engine: GwenEngine): void {
  for (const entity of engine.createLiveQuery([Health])) {
    const hp = entity.get(Health);
    if (hp.current < hp.max) {
      engine.addComponent(entity.id, Health, {
        current: Math.min(hp.current + hp.regenRate * DT, hp.max),
        max: hp.max,
        regenRate: hp.regenRate,
      });
    }
  }
}

describe("engine frame simulation", () => {
  const engines: GwenEngine[] = [];
  let full1k: GwenEngine;
  let full5k: GwenEngine;
  let sparse1k: GwenEngine;

  beforeAll(async () => {
    full1k = await world(1_000, false);
    full5k = await world(5_000, false);
    sparse1k = await world(1_000, true);
    engines.push(full1k, full5k, sparse1k);
  });

  afterAll(async () => {
    for (const engine of engines) await engine.stop();
  });

  bench("movement — 1 000 entities", () => move(full1k), ONCE);
  bench("movement — 5 000 entities", () => move(full5k), ONCE);
  bench(
    "movement + health — 1 000 entities",
    () => {
      move(full1k);
      heal(full1k);
    },
    ONCE,
  );
  bench("movement — sparse 1 000", () => move(sparse1k), ONCE);
});

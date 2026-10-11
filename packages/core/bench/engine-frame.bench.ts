/**
 * One public-API frame sample: 1000x advance(1/60), one handler on every phase,
 * and a live query over 1000 entities.
 *
 * Run (prod). Each sample is one stdout line `ENGINE_FRAME_MS <milliseconds>`.
 * That line is the return of measureEngineFrame(), not the Vitest hz column.
 *   pnpm --filter @gwenjs/core exec vitest bench --run --project prod bench/engine-frame.bench.ts
 */
import { bench } from "vitest";

import { createEngine, defineComponent, Types } from "../src/index.js";
import { defineSystem, onUpdate, useQuery } from "../src/system/index.js";

const Position = defineComponent({
  name: "EngineFrameBenchPosition",
  schema: { x: Types.f32 },
});

let sink = 0;

export async function measureEngineFrame(): Promise<number> {
  const engine = await createEngine();
  try {
    for (let index = 0; index < 1000; index += 1) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: index });
    }
    await engine.use(
      defineSystem(() => {
        const query = useQuery([Position]);
        onUpdate(() => {
          let sum = 0;
          for (const entity of query) {
            const pos = entity.get(Position);
            if (!pos) continue;
            pos.x += 1;
            sum += pos.x;
          }
          sink = sum;
        });
      })(),
    );
    engine.hooks.hook("engine:tick", () => {
      sink += 1;
    });
    engine.hooks.hook("engine:before-update", () => {
      sink += 1;
    });
    engine.hooks.hook("engine:after-update", () => {
      sink += 1;
    });
    engine.hooks.hook("engine:render", () => {
      sink += 1;
    });
    engine.hooks.hook("engine:afterTick", () => {
      sink += 1;
    });
    await engine.startExternal();
    const started = performance.now();
    for (let frame = 0; frame < 1000; frame += 1) {
      await engine.advance(1 / 60);
    }
    return performance.now() - started;
  } finally {
    if (engine.state !== "stopped") await engine.stop();
  }
}

bench(
  "advance(1/60) x1000, one handler per phase, live query of 1000",
  async () => {
    const elapsed = await measureEngineFrame();
    process.stdout.write(`ENGINE_FRAME_MS ${elapsed}\n`);
    if (elapsed < 0 || sink < 0) throw new Error("unreachable");
  },
  { iterations: 1, warmupIterations: 0, warmupTime: 0, time: 0 },
);

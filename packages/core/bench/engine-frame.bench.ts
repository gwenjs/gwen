/**
 * One public-API frame sample: 1000x advance(1/60), one handler on every phase,
 * and a live query over 1000 entities.
 *
 * Run (prod). Each sample is one stdout line `ENGINE_FRAME_MS <milliseconds>`.
 * That line is the return of measureEngineFrame(), not the Vitest hz column.
 *   pnpm --filter @gwenjs/core exec vitest bench --run --project prod bench/engine-frame.bench.ts
 */
import { bench } from "vitest";

import { createEngine, defineComponent, readInterpolatedTransform2D, Types } from "../src/index.js";
import { entityIndex } from "../src/internal.js";
import { defineSystem, onUpdate, useQuery } from "../src/system/index.js";
import { createRealEngine } from "../src/testing/create-real-engine.js";

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
          for (const entity of query.each()) {
            const pos = entity.get(Position);
            if (!pos) continue;
            const next = pos.x + 1;
            engine.addComponent(entity.id, Position, { x: next });
            sum += next;
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

/**
 * Fixed 60 Hz, 120 display frames of `advance(1/120)`, 1000 transforms.
 * `idle` is the loop alone. `read` adds one hoisted helper read of every slot.
 */
export async function measureInterpolatedFrame(): Promise<{ idle: number; read: number }> {
  const handle = await createRealEngine({ variant: "light", physicsHz: 60, maxEntities: 1000 });
  const engine = handle.engine;
  try {
    const wasm = handle.bridge.engine();
    for (let index = 0; index < 1000; index += 1) {
      const id = engine.createEntity();
      wasm.add_entity_transform(entityIndex(id), index, 0, 0, 1, 1);
    }
    const out = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    const idleStart = performance.now();
    await handle.advance(120, 1 / 120);
    const idle = performance.now() - idleStart;
    engine.hooks.hook("engine:render", (alpha: number) => {
      const pair = engine.frame.transforms2D;
      if (pair === null) return;
      for (let slot = 0; slot < 1000; slot += 1) {
        if (readInterpolatedTransform2D(pair, slot, alpha, out)) sink = out.x;
      }
    });
    const readStart = performance.now();
    await handle.advance(120, 1 / 120);
    return { idle, read: performance.now() - readStart };
  } finally {
    await handle.dispose();
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

bench(
  "fixed 60 Hz, advance(1/120) x120, 1000 transforms, helper read",
  async () => {
    const elapsed = await measureInterpolatedFrame();
    process.stdout.write(`INTERP_FRAME_MS idle ${elapsed.idle} read ${elapsed.read}\n`);
    if (elapsed.idle < 0 || elapsed.read < 0 || sink < 0) throw new Error("unreachable");
  },
  { iterations: 1, warmupIterations: 0, warmupTime: 0, time: 0 },
);

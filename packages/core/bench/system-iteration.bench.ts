/**
 * One chunk loop over `Position` + `Velocity`, run as written (`optimizer: false`) and as the
 * transform writes it (`optimizer: true`, the committed golden `system-iteration.optimized.ts`).
 * Each row measures `advance(1, 1/60)` on one real engine, after 400 warmup frames.
 * `tests/integration-wasm/p69-hot-path-parity.test.ts` proves both systems write the same values.
 *
 * Run (prod). The summary table is condensed: read the numbers from the JSON file.
 *   pnpm --filter @gwenjs/core exec vitest bench --run --project prod bench/system-iteration.bench.ts --outputJson <file>
 */

import { bench, describe } from "vitest";

import { createRealEngine, type RealEngineHandle } from "../tests/integration-wasm/harness.js";
import { Position, Velocity } from "./fixtures/system-iteration.components";
import { Mover as hoisted } from "./fixtures/system-iteration.optimized";
import { Mover as plain } from "./fixtures/system-iteration.source";

const DT = 1 / 60;
const WARMUP_FRAMES = 400;

function register(optimizer: boolean, factory: typeof plain, entities: number): void {
  let handle: RealEngineHandle | undefined;
  // tinybench 2.9.0 runs `setup`/`teardown` once for "warmup" and once for "run", and the same
  // `handle` serves both. It calls `teardown(_, "warmup")` before it stores the loop error, and it
  // skips the "run" phase of a task whose warmup failed (node_modules/tinybench/dist/index.js:309-310,
  // :355-357). So a frame that throws is recorded here, and the "warmup" teardown releases then.
  let failed = false;
  bench(
    `optimizer: ${optimizer}, ${entities} entities`,
    async () => {
      if (!handle) throw new Error("engine was not built");
      try {
        await handle.advance(1, DT);
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    {
      async setup() {
        if (handle) return;
        const built = await createRealEngine({ variant: "light", maxEntities: entities + 64 });
        try {
          for (let i = 0; i < entities; i++) {
            const id = built.engine.createEntity();
            built.engine.addComponent(id, Position, { x: i, y: 0 });
            built.engine.addComponent(id, Velocity, { vx: 1, vy: 0.5 });
          }
          await built.engine.use(factory());
          await built.advance(WARMUP_FRAMES, DT);
        } catch (error) {
          await built.dispose();
          throw error;
        }
        handle = built;
      },
      async teardown(_task, mode) {
        if (mode !== "run" && !failed) return;
        const done = handle;
        handle = undefined;
        await done?.dispose();
      },
    },
  );
}

describe("system iteration (real WASM)", () => {
  for (const entities of [1000, 10_000]) {
    register(false, plain, entities);
    register(true, hoisted, entities);
  }
});

import { expect, test } from "vitest";

import { defineLayout } from "../../src/actor/runtime/define-layout";
import { placeGroup } from "../../src/actor/runtime/place";
import type { PlaceHandle } from "../../src/actor/runtime/types";
import { useLayout } from "../../src/actor/runtime/use-layout";
import { createRealEngine } from "../../tests/integration-wasm/harness";
import { measureAllocations } from "./measure";

/** `placeGroup` calls per layout. Large enough that per-load costs vanish in the average. */
const PLACES = 400;
const REPEATS = 9;

/**
 * Highest accepted heap bytes per `placeGroup` call in a one-pass `useLayout().load()`.
 *
 * Measured on Node 22, real `light` WASM, minimum of 9 GC-free loads, two runs each:
 * about 1447 B per call with one shared `register` function per layout and no queue array,
 * about 1502 B per call when each call also allocates a `register` closure and the load
 * allocates a queue array. The limit sits between the two. Lower it from measured runs only.
 */
const MAX_BYTES_PER_PLACE = 1475;

test("a one-pass useLayout load stays within its bytes-per-place budget", async () => {
  const handle = await createRealEngine({ variant: "light", maxEntities: 4096 });
  try {
    const layout = defineLayout(() => {
      const refs: Record<string, PlaceHandle<void>> = {};
      for (let i = 0; i < PLACES; i++) refs[`g${String(i)}`] = placeGroup({ at: [i, 0] });
      return refs;
    });
    const samples: number[] = [];
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const layoutHandle = await handle.engine.run(() => useLayout(layout, { lazy: true }));
      const report = await measureAllocations(
        async () => {
          await layoutHandle.load();
        },
        { warmup: 0, ops: PLACES },
      );
      await layoutHandle.dispose();
      if (report.gcCount === 0) samples.push(report.bytesPerOp);
    }
    expect(samples.length).toBeGreaterThanOrEqual(3);
    const best = Math.min(...samples);
    expect(best, `layout.load measured ${String(best)} bytes per place`).toBeLessThanOrEqual(
      MAX_BYTES_PER_PLACE,
    );
  } finally {
    await handle.dispose();
  }
}, 300_000);

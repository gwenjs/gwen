/**
 * @module timing-gate.test
 * Wall-clock gates moved out of the unit suite.
 *
 * Same budgets as the former `tests/composables/performance.test.ts`. That file
 * timed the composables over a mocked service; these gates time the service
 * calls the composables forward to, on a real WASM engine, with no mocks.
 * Each gate times the operation several times and checks the median against
 * the budget, then prints the numbers to the bench output. The behaviour of
 * the same operations is covered by `tests/composables/bulk-operations.test.ts`.
 *
 * Skipped unless `BENCH_SLOW` is set, like `solver.test.ts`, so the unit suite
 * never asserts elapsed time. The CI Benchmarks job runs it through `bench:ci`.
 */
import { describe, it, expect } from "vitest";
import type { EntityId } from "@gwenjs/core";
import { createRealEngine } from "../../core/tests/integration-wasm/harness.js";
import "../src/augment.js";
import { Physics2DPlugin } from "../src/index.js";
import { ciThreshold, measureMedianMs, reportTiming } from "./perf";

const BENCH_SLOW = Boolean(process.env["BENCH_SLOW"]);

/** Room for the warm-up and sampled runs of the 1000-body gate. */
const MAX_ENTITIES = 32_768;

describe.skipIf(!BENCH_SLOW)("physics2d timing gates", () => {
  it("creates 1000 static bodies in under 100ms (median)", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: MAX_ENTITIES });
    try {
      const { engine } = handle;
      await engine.use(Physics2DPlugin({ maxEntities: MAX_ENTITIES }));
      const physics = engine.inject("physics2d");
      const budget = ciThreshold(100);
      // useStaticBody() forwards to addRigidBody(entityId, "fixed", 0, 0).
      const sample = measureMedianMs(
        () => {
          const ids: EntityId[] = [];
          for (let i = 0; i < 1_000; i++) ids.push(engine.createEntity());
          return ids;
        },
        (ids) => {
          for (const id of ids) physics.addRigidBody(id, "fixed", 0, 0);
        },
      );
      expect(reportTiming("create 1000 static bodies", sample, budget)).toBeLessThan(budget);
    } finally {
      await handle.dispose();
    }
  });

  it("applies 1000 impulses in under 5ms (median)", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 64 });
    try {
      const { engine } = handle;
      await engine.use(Physics2DPlugin({ maxEntities: 64 }));
      const physics = engine.inject("physics2d");
      const id = engine.createEntity();
      physics.addRigidBody(id, "dynamic", 0, 0);
      const budget = ciThreshold(5);
      // useDynamicBody().applyImpulse(ix, iy) forwards to applyImpulse(entityId, ix, iy).
      const sample = measureMedianMs(
        () => id,
        (target) => {
          for (let i = 0; i < 1_000; i++) physics.applyImpulse(target, 1, 0);
        },
      );
      expect(reportTiming("apply 1000 impulses", sample, budget)).toBeLessThan(budget);
    } finally {
      await handle.dispose();
    }
  });
});

/**
 * Wall-clock gates moved out of the unit suite.
 *
 * Same budgets as the former `tests/physics3d.perf.test.ts` and the large-grid
 * case of `tests/gaps.test.ts`. The contact ring buffer and its drain case are
 * gone from the package, so there is no drain gate. The body gate used to time
 * useDynamicBody() over a mocked service; it now times the createBody() call
 * that the composable forwards to, on a real WASM engine, with no mocks. The
 * dispatch gate runs inside that engine, since contact callbacks are per engine.
 * Each gate times the operation several times and checks the median against the budget, then prints the
 * numbers to the bench output. The behaviour of the same operations is covered
 * by `tests/bulk-operations.test.ts` and `tests/gaps.test.ts`.
 *
 * Skipped unless `BENCH_SLOW` is set, like `packages/physics2d/bench/solver.test.ts`,
 * so the unit suite never asserts elapsed time. The CI Benchmarks job runs it
 * with `pnpm bench:physics3d:ci` (`BENCH_SLOW=1 vitest run --reporter=verbose bench/timing-gate.test.ts`).
 */
import { describe, it, expect } from "vitest";
import type { EntityId } from "@gwenjs/core";
import { createRealEngine } from "../../core/tests/integration-wasm/harness.js";
import "../src/augment.js";
import { Physics3DPlugin } from "../src/plugin/index.js";
import { createPluginContext } from "../src/plugin/plugin-context.js";
import { createPathfindingMethods } from "../src/plugin/pathfinding-service.js";
import { buildLayerRegistry, normalizePhysics3DConfig } from "../src/config.js";
import {
  onContact,
  _dispatchContactEvent,
  _clearContactCallbacks,
} from "../src/composables/on-contact.js";
import type { Physics3DCollisionContact } from "../src/types.js";
import { ciThreshold, measureMedianMs, reportTiming } from "./perf";

const BENCH_SLOW = Boolean(process.env["BENCH_SLOW"]);

/** Room for the warm-up and sampled runs of the 500-body gate. */
const MAX_ENTITIES = 16_384;

describe.skipIf(!BENCH_SLOW)("physics3d timing gates", () => {
  it("creates 500 dynamic bodies in < 20ms (median)", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: MAX_ENTITIES });
    try {
      const { engine } = handle;
      await engine.use(Physics3DPlugin({ maxEntities: MAX_ENTITIES }));
      const physics = engine.inject("physics3d");
      const budget = ciThreshold(20);
      // useDynamicBody() forwards to createBody(entityId, { kind: "dynamic" }).
      const sample = measureMedianMs(
        () => {
          const ids: EntityId[] = [];
          for (let i = 0; i < 500; i++) ids.push(engine.createEntity());
          return ids;
        },
        (ids) => {
          for (const id of ids) physics.createBody(id, { kind: "dynamic" });
        },
      );
      expect(reportTiming("create 500 dynamic bodies", sample, budget)).toBeLessThan(budget);
    } finally {
      await handle.dispose();
    }
  });

  it("dispatches 500 onContact events per frame in < 1ms (median)", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 64 });
    try {
      const { engine } = handle;
      // Contact callbacks live on the current engine: outside one, dispatch is a no-op.
      const sample = engine.run(() => {
        _clearContactCallbacks();
        let calls = 0;
        onContact(() => {
          calls += 1;
        });
        const event: Physics3DCollisionContact = { entityA: 1n, entityB: 2n, started: true };
        const timing = measureMedianMs(
          () => event,
          (e) => {
            for (let i = 0; i < 500; i++) {
              _dispatchContactEvent(e);
            }
          },
        );
        _clearContactCallbacks();
        // 3 warm-up runs + 21 samples, 500 dispatches each: the timed path reached the callback.
        expect(calls).toBe(24 * 500);
        return timing;
      });
      const budget = ciThreshold(1);
      expect(reportTiming("dispatch 500 onContact events", sample, budget)).toBeLessThan(budget);
    } finally {
      await handle.dispose();
    }
  });

  it("finds a path across a 30x1x30 open grid in < 50ms (median)", () => {
    const ctx = createPluginContext(normalizePhysics3DConfig(), buildLayerRegistry([]));
    const pathfinding = createPathfindingMethods(ctx);
    pathfinding.initNavGrid3D({
      grid: new Uint8Array(30 * 1 * 30),
      width: 30,
      height: 1,
      depth: 30,
      cellSize: 1,
    });
    const budget = ciThreshold(50);
    const sample = measureMedianMs(
      () => undefined,
      () => {
        pathfinding.findPath3D({ x: 0, y: 0, z: 0 }, { x: 28, y: 0, z: 28 });
      },
    );
    expect(reportTiming("findPath3D 30x1x30 grid", sample, budget)).toBeLessThan(budget);
  });
});

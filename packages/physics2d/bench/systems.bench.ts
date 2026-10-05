/**
 * @module systems.bench
 * Vitest benchmark suite for Physics2DKinematicSyncSystem live-query performance.
 *
 * Measures the cost of the `onBeforeUpdate` hot path for varying entity counts.
 * All fixtures are pre-allocated outside `bench()` calls so only the iteration
 * + setKinematicPosition dispatch overhead is measured, not the setup cost.
 *
 * Baseline machine: M-series Mac, single-threaded Node 20.
 * Reference timings (approximate, not enforced):
 *   -   100 bodies: ~0.01 ms
 *   -  1000 bodies: ~0.1 ms
 *   - 10000 bodies: ~1 ms
 */

import { describe, bench, vi, beforeAll } from "vitest";
import type { EntityId } from "@gwenjs/core";
import type { ComponentDef } from "@gwenjs/core/system";
import { createPhysicsKinematicSyncSystem } from "../src/systems";

const position = { name: "position" } as ComponentDef;
import type { Physics2DAPI } from "../src/types";

// ─── Minimal stubs ─────────────────────────────────────────────────────────────

/**
 * Returns a no-op Physics2DAPI stub — only `setKinematicPosition` is needed
 * for the sync system hot path.
 */
function makePhysicsStub(): Pick<Physics2DAPI, "setKinematicPosition"> {
  return { setKinematicPosition: vi.fn() };
}

/**
 * A minimal entity accessor returned by the fake live query.
 * `get()` always returns a `{ x, y }` position so the sync path is exercised.
 */
interface FakeAccessor {
  readonly id: EntityId;
  get(def: unknown): { x: number; y: number };
}

/** Builds an array of N fake entity accessors with random-ish positions. */
function buildAccessors(count: number): FakeAccessor[] {
  return Array.from({ length: count }, (_, i) => ({
    id: BigInt(i + 1) as EntityId,
    get: (_def: unknown) => ({ x: i * 1.5, y: i * 0.75 }),
  }));
}

/**
 * Builds a fake engine mock whose live-query yields `accessors` on every
 * iteration. The mock reuses the same iterator factory so it allocates the
 * same amount of memory each frame — mimicking the real engine behaviour.
 */
function makeEngineStub(accessors: FakeAccessor[]) {
  const hookMap = new Map<string, (dt: number) => void>();
  return {
    inject: (_key: string) => makePhysicsStub(),
    hooks: {
      hook(name: string, callback: (dt: number) => void): () => void {
        hookMap.set(name, callback);
        return () => {
          if (hookMap.get(name) === callback) hookMap.delete(name);
        };
      },
    },
    hookMap,
    createLiveQuery: (_components: unknown[]) => ({
      [Symbol.iterator]() {
        let i = 0;
        return {
          next(): IteratorResult<FakeAccessor> {
            if (i < accessors.length) return { done: false, value: accessors[i++]! };
            return { done: true, value: undefined as unknown as FakeAccessor };
          },
        };
      },
    }),
  };
}

// ─── Fixture setup ─────────────────────────────────────────────────────────────

// Pre-allocate all fixture sizes so bench() bodies contain zero allocation.
const SPARSE_COUNT = 100;
const MEDIUM_COUNT = 1_000;
const DENSE_COUNT = 10_000;

let step100: (dt: number) => void;
let step1000: (dt: number) => void;
let step10000: (dt: number) => void;

function registeredStep(hookMap: Map<string, (dt: number) => void>): (dt: number) => void {
  const step = hookMap.get("engine:before-update");
  if (step === undefined) {
    throw new Error("engine:before-update was not registered");
  }
  return step;
}

beforeAll(() => {
  // Silence vi.fn mock overhead from polluting timings by using a bare function.
  const makeBareMock = () => ({
    inject: (_key: string) => ({
      setKinematicPosition: (_id: EntityId, _x: number, _y: number) => {},
    }),
    createLiveQuery: (_components: unknown[]) => ({
      [Symbol.iterator]() {
        return { next: () => ({ done: true, value: undefined as unknown as FakeAccessor }) };
      },
    }),
  });

  // Sparse scenario: 100 matching bodies out of a conceptual pool of 10 000.
  const accessors100 = buildAccessors(SPARSE_COUNT);
  const system100 = createPhysicsKinematicSyncSystem({
    pixelsPerMeter: 50,
    positionComponent: position,
  });
  const engine100 = makeEngineStub(accessors100);
  system100.setup(engine100 as Parameters<typeof system100.setup>[0]);
  step100 = registeredStep(engine100.hookMap);

  // Medium scenario: 1 000 matching bodies.
  const accessors1000 = buildAccessors(MEDIUM_COUNT);
  const system1000 = createPhysicsKinematicSyncSystem({
    pixelsPerMeter: 50,
    positionComponent: position,
  });
  const engine1000 = makeEngineStub(accessors1000);
  system1000.setup(engine1000 as Parameters<typeof system1000.setup>[0]);
  step1000 = registeredStep(engine1000.hookMap);

  // Dense scenario: 10 000 matching bodies.
  const accessors10000 = buildAccessors(DENSE_COUNT);
  const system10000 = createPhysicsKinematicSyncSystem({
    pixelsPerMeter: 50,
    positionComponent: position,
  });
  const engine10000 = makeEngineStub(accessors10000);
  system10000.setup(engine10000 as Parameters<typeof system10000.setup>[0]);
  step10000 = registeredStep(engine10000.hookMap);

  // Suppress unused-variable lint for the bare mock factory.
  void makeBareMock;
});

// ─── Benchmarks ────────────────────────────────────────────────────────────────

describe("Physics2DKinematicSyncSystem — live query performance", () => {
  bench("sync 100 bodies (sparse: 100 / 10 000 entities)", () => {
    step100(0.016);
  });

  bench("sync 1 000 bodies", () => {
    step1000(0.016);
  });

  bench("sync 10 000 bodies (dense)", () => {
    step10000(0.016);
  });
});

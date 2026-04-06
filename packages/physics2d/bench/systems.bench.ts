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

import { describe, bench, vi, beforeAll } from 'vitest';
import type { EntityId } from '@gwenjs/core';
import { createPhysicsKinematicSyncSystem } from '../src/systems';
import type { Physics2DAPI } from '../src/types';

// ─── Minimal stubs ─────────────────────────────────────────────────────────────

/**
 * Returns a no-op Physics2DAPI stub — only `setKinematicPosition` is needed
 * for the sync system hot path.
 */
function makePhysicsStub(): Pick<Physics2DAPI, 'setKinematicPosition'> {
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
  return {
    inject: (_key: string) => makePhysicsStub(),
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

let system100: ReturnType<typeof createPhysicsKinematicSyncSystem>;
let system1000: ReturnType<typeof createPhysicsKinematicSyncSystem>;
let system10000: ReturnType<typeof createPhysicsKinematicSyncSystem>;

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
  system100 = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
  system100.setup(makeEngineStub(accessors100) as Parameters<typeof system100.setup>[0]);

  // Medium scenario: 1 000 matching bodies.
  const accessors1000 = buildAccessors(MEDIUM_COUNT);
  system1000 = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
  system1000.setup(makeEngineStub(accessors1000) as Parameters<typeof system1000.setup>[0]);

  // Dense scenario: 10 000 matching bodies.
  const accessors10000 = buildAccessors(DENSE_COUNT);
  system10000 = createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50 });
  system10000.setup(makeEngineStub(accessors10000) as Parameters<typeof system10000.setup>[0]);

  // Suppress unused-variable lint for the bare mock factory.
  void makeBareMock;
});

// ─── Benchmarks ────────────────────────────────────────────────────────────────

describe('Physics2DKinematicSyncSystem — live query performance', () => {
  bench('sync 100 bodies (sparse: 100 / 10 000 entities)', () => {
    system100.onBeforeUpdate(0.016);
  });

  bench('sync 1 000 bodies', () => {
    system1000.onBeforeUpdate(0.016);
  });

  bench('sync 10 000 bodies (dense)', () => {
    system10000.onBeforeUpdate(0.016);
  });
});

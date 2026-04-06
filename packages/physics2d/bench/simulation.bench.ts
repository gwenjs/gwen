/**
 * @module simulation.bench
 *
 * Physics2D simulation step benchmarks for @gwenjs/physics2d.
 *
 * Measures full JS-side overhead of a physics step including WASM call
 * dispatch, collision event reading, and tilemap chunk loading.
 *
 * All Physics2DAPI calls are mocked (no WASM required) to isolate the
 * TypeScript orchestration overhead from the Rust physics cost. The Rust
 * solver is already covered by bench/solver.test.ts.
 *
 * Pre-computed fixtures are created OUTSIDE `bench()` calls to avoid
 * polluting measurements with setup overhead.
 *
 * Baseline machine: M-series Mac, single-threaded Node 20.
 *
 * Run:
 *   pnpm --filter @gwenjs/physics2d bench
 */

import { describe, bench } from 'vitest';

import type {
  Physics2DAPI,
  CollisionEvent,
  CollisionEventsBatch,
  TilemapPhysicsChunk,
  TilemapPhysicsChunkMap,
} from '../src/types';
import { dedupeContactsByPair } from '../src/helpers/contact';
import { buildTilemapPhysicsChunks } from '../src/helpers/tilemap';
import { makeTiles } from './fixtures';

// ---------------------------------------------------------------------------
// Mock Physics2DAPI — no-op, isolates TS overhead from WASM
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock that satisfies the `Physics2DAPI` contract.
 *
 * Every method is a no-op or returns a sensible zero value. The
 * simulation benchmarks call `step()` and `loadTilemapPhysicsChunk()`
 * on this mock to measure the JS dispatch cost only.
 */
function makeMockPhysics(): Physics2DAPI {
  let bodyHandleCounter = 0;

  return {
    addRigidBody: (_entityId, _type, _x, _y, _opts): number => ++bodyHandleCounter,
    addBoxCollider: () => undefined,
    addBallCollider: () => undefined,
    removeBody: () => undefined,
    setKinematicPosition: () => undefined,
    applyImpulse: () => undefined,
    setLinearVelocity: () => undefined,
    getLinearVelocity: () => ({ x: 0, y: 0 }),
    getPosition: () => ({ x: 0, y: 0, rotation: 0 }),
    getSensorState: () => ({ active: false, count: 0 }),
    updateSensorState: () => undefined,
    getCollisionEventsBatch: (): CollisionEventsBatch => ({
      frame: 1,
      count: EVENTS_1000.length,
      droppedSinceLastRead: 0,
      droppedCritical: 0,
      droppedNonCritical: 0,
      coalesced: false,
      events: EVENTS_1000,
    }),
    getCollisionContacts: () => [],
    loadTilemapPhysicsChunk: () => undefined,
    unloadTilemapPhysicsChunk: () => undefined,
    patchTilemapPhysicsChunk: () => undefined,
    isDebugEnabled: () => false,
  } as unknown as Physics2DAPI;
}

// ---------------------------------------------------------------------------
// Collision event fixtures
// ---------------------------------------------------------------------------

/**
 * Generates N synthetic collision events with a realistic duplicate ratio (~30%).
 */
function makeEvents(count: number): CollisionEvent[] {
  const COLLIDER_POOL = 64;
  return Array.from({ length: count }, (_, i) => ({
    aColliderId: i % COLLIDER_POOL,
    bColliderId: (i * 7 + 3) % COLLIDER_POOL,
    started: i % 3 !== 0,
  }));
}

/** Wraps an events array into a minimal `CollisionEventsBatch`. */
function makeBatch(events: CollisionEvent[]): CollisionEventsBatch {
  return {
    frame: 1,
    count: events.length,
    droppedSinceLastRead: 0,
    droppedCritical: 0,
    droppedNonCritical: 0,
    coalesced: false,
    events,
  };
}

const EVENTS_100 = makeEvents(100);
const EVENTS_1000 = makeEvents(1_000);

const BATCH_100 = makeBatch(EVENTS_100);
const BATCH_1000 = makeBatch(EVENTS_1000);

// ---------------------------------------------------------------------------
// Tilemap chunk fixtures
// ---------------------------------------------------------------------------

const CHUNK_MAP_SMALL: TilemapPhysicsChunkMap = buildTilemapPhysicsChunks({
  tiles: makeTiles(32, 32),
  mapWidthTiles: 32,
  mapHeightTiles: 32,
  chunkSizeTiles: 16,
  tileSizePx: 16,
});

const FIRST_CHUNK: TilemapPhysicsChunk | undefined = CHUNK_MAP_SMALL.chunks[0];

// ---------------------------------------------------------------------------
// Helpers for step simulation
// ---------------------------------------------------------------------------

/**
 * Simulate N physics step calls on the mock API.
 *
 * Calls `getCollisionEventsBatch()` + `dedupeContactsByPair()` per step to
 * reflect the realistic hot path cost of one physics frame.
 */
function simulateSteps(physics: Physics2DAPI, steps: number): void {
  for (let i = 0; i < steps; i++) {
    // In real code: physics.step(delta) dispatches to WASM.
    // The mock returns immediately, so this measures only the TS overhead.
    const batch = physics.getCollisionEventsBatch();
    // Deduplicate events — this is called every frame in production.
    if (batch.count > 0) {
      dedupeContactsByPair(batch.events);
    }
  }
}

// ---------------------------------------------------------------------------
// Benchmark: simulation step overhead
// ---------------------------------------------------------------------------

describe('Physics2D — simulation step (mock API)', () => {
  const physics = makeMockPhysics();

  bench('step() × 50 — low body count scenario', () => {
    simulateSteps(physics, 50);
  });

  bench('step() × 200 — medium body count scenario', () => {
    simulateSteps(physics, 200);
  });

  bench('step() × 1000 — stress scenario', () => {
    simulateSteps(physics, 1_000);
  });
});

// ---------------------------------------------------------------------------
// Benchmark: collision event processing
// ---------------------------------------------------------------------------

describe('Physics2D — collision event processing', () => {
  bench('dedupeContactsByPair — 100 events per frame × 100 frames', () => {
    for (let f = 0; f < 100; f++) {
      dedupeContactsByPair(EVENTS_100);
    }
  });

  bench('dedupeContactsByPair — 1000 events per frame × 100 frames', () => {
    for (let f = 0; f < 100; f++) {
      dedupeContactsByPair(EVENTS_1000);
    }
  });

  bench('read and process CollisionEventsBatch — 100 events', () => {
    const { events } = BATCH_100;
    let started = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.started) started++;
    }
    return started;
  });

  bench('read and process CollisionEventsBatch — 1000 events', () => {
    const { events } = BATCH_1000;
    let started = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.started) started++;
    }
    return started;
  });
});

// ---------------------------------------------------------------------------
// Benchmark: tilemap chunk operations
// ---------------------------------------------------------------------------

describe('Physics2D — tilemap chunk operations', () => {
  const physics = makeMockPhysics();

  bench('loadTilemapPhysicsChunk() — 16×16 chunk × 100', () => {
    if (!FIRST_CHUNK) return;
    for (let i = 0; i < 100; i++) {
      physics.loadTilemapPhysicsChunk(FIRST_CHUNK, 0, 0);
    }
  });

  bench('unloadTilemapPhysicsChunk() — cleanup × 100', () => {
    for (let i = 0; i < 100; i++) {
      physics.unloadTilemapPhysicsChunk('chunk_0_0');
    }
  });

  bench('buildTilemapPhysicsChunks() — 32×32 tile map', () => {
    buildTilemapPhysicsChunks({
      tiles: makeTiles(32, 32),
      mapWidthTiles: 32,
      mapHeightTiles: 32,
      chunkSizeTiles: 16,
      tileSizePx: 16,
    });
  });
});

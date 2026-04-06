/**
 * @module helpers.bench
 * Vitest benchmark suite for @gwenjs/physics2d pure-TS helper functions.
 *
 * Covers hot-path helpers called every frame in production games:
 * - `dedupeContactsByPair` — deduplication of collision events (O(n) Set scan)
 * - `selectContactsForEntityId` — per-entity event filtering
 *
 * WASM-dependent helpers (movement, queries) are excluded — their TS overhead
 * is negligible compared to the underlying WASM call. The Rust solver bench
 * covers the physics computation budget.
 *
 * All fixtures are pre-computed outside `bench()` calls to measure only the
 * function under test, with no allocation overhead in the hot path.
 */

import { describe, bench } from 'vitest';
import { createEntityId } from '@gwenjs/core';
import type { EntityId } from '@gwenjs/core';
import { dedupeContactsByPair, selectContactsForEntityId } from '../src/helpers/contact';
import type { CollisionEvent, CollisionEventsBatch } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

/**
 * Generates N synthetic collision events.
 *
 * Alternates started/ended flags and distributes collider IDs across a pool
 * so that ~30% of events are duplicates — a realistic scenario for a
 * busy physics simulation with 100–500 active bodies.
 */
function makeEvents(count: number): CollisionEvent[] {
  const COLLIDER_POOL = 64;
  return Array.from({ length: count }, (_, i) => ({
    aColliderId: i % COLLIDER_POOL,
    bColliderId: (i * 7 + 3) % COLLIDER_POOL,
    started: i % 3 !== 0,
  }));
}

/**
 * Wraps an events array into a minimal `CollisionEventsBatch`.
 */
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

// ---------------------------------------------------------------------------
// Pre-computed fixtures
// ---------------------------------------------------------------------------

const EVENTS_100 = makeEvents(100);
const EVENTS_500 = makeEvents(500);
const EVENTS_1000 = makeEvents(1000);

const BATCH_100 = makeBatch(EVENTS_100);
const BATCH_500 = makeBatch(EVENTS_500);
const BATCH_1000 = makeBatch(EVENTS_1000);

// EntityId for entity at slot 7, generation 1 — appears in ~1/64 events
const TARGET_ENTITY: EntityId = createEntityId(7, 1);

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('contact helpers — dedupeContactsByPair', () => {
  bench('dedupeContactsByPair — 100 events', () => {
    dedupeContactsByPair(EVENTS_100);
  });

  bench('dedupeContactsByPair — 500 events', () => {
    dedupeContactsByPair(EVENTS_500);
  });

  bench('dedupeContactsByPair — 1000 events', () => {
    dedupeContactsByPair(EVENTS_1000);
  });
});

describe('contact helpers — selectContactsForEntityId', () => {
  bench('selectContactsForEntityId — 100 events', () => {
    selectContactsForEntityId(BATCH_100, TARGET_ENTITY);
  });

  bench('selectContactsForEntityId — 500 events', () => {
    selectContactsForEntityId(BATCH_500, TARGET_ENTITY);
  });

  bench('selectContactsForEntityId — 1000 events', () => {
    selectContactsForEntityId(BATCH_1000, TARGET_ENTITY);
  });
});

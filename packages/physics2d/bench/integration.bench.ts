/**
 * @module integration.bench
 * Integration benchmark suite for @gwenjs/physics2d — realistic game-loop scenario.
 *
 * Simulates a platformer-style game loop where each frame:
 * 1. Camera moves → chunk visibility changes → `syncVisibleChunks` diffs loaded set
 * 2. Destructible tile edited → `patchChunk` rebakes one chunk and reloads it
 * 3. Collision events arrive → `dedupeContactsByPair` + `selectContactsForEntityId`
 *
 * All Physics2DAPI calls are mocked (no WASM required) to isolate the TypeScript
 * orchestration overhead from the Rust physics cost. The Rust solver is already
 * covered by bench/solver.test.ts.
 *
 * Pre-computed fixtures are created outside `bench()` calls.
 */

import { describe, bench } from 'vitest';
import { createEntityId } from '@gwenjs/core';
import type { EntityId } from '@gwenjs/core';

import { buildTilemapPhysicsChunks } from '../src/helpers/tilemap';
import { createTilemapChunkOrchestrator } from '../src/helpers/orchestration';
import { dedupeContactsByPair, selectContactsForEntityId } from '../src/helpers/contact';
import type {
  CollisionEvent,
  CollisionEventsBatch,
  Physics2DAPI,
  TilemapPhysicsChunk,
} from '../src/types';
import { makeTiles } from './fixtures';

// ---------------------------------------------------------------------------
// Mock Physics2DAPI (no-op — isolates TS overhead from WASM)
// ---------------------------------------------------------------------------

function makeMockPhysics(): Physics2DAPI {
  return {
    addBody: () => undefined as never,
    addBoxCollider: () => undefined as never,
    addBallCollider: () => undefined as never,
    removeBody: () => undefined,
    setKinematicPosition: () => undefined,
    applyImpulse: () => undefined,
    setLinearVelocity: () => undefined,
    getLinearVelocity: () => ({ vx: 0, vy: 0 }),
    getPosition: () => ({ x: 0, y: 0, angle: 0 }),
    getSensorState: () => ({ active: false, count: 0 }),
    updateSensorState: () => undefined,
    getCollisionEventsBatch: () => ({
      frame: 0,
      count: 0,
      droppedSinceLastRead: 0,
      droppedCritical: 0,
      droppedNonCritical: 0,
      coalesced: false,
      events: [],
    }),
    getCollisionContacts: () => [],
    buildNavmesh: () => undefined,
    findPath: () => [],
    loadTilemapPhysicsChunk: (_chunk: TilemapPhysicsChunk) => undefined,
    unloadTilemapPhysicsChunk: () => undefined,
    patchTilemapPhysicsChunk: () => undefined,
    isDebugEnabled: () => false,
  } as unknown as Physics2DAPI;
}

// ---------------------------------------------------------------------------
// Pre-computed fixtures
// ---------------------------------------------------------------------------

const MAP_WIDTH = 128;
const MAP_HEIGHT = 64;
const CHUNK_SIZE = 16;
const TILE_SIZE = 16;

const tiles = makeTiles(MAP_WIDTH, MAP_HEIGHT);

const tilemapInput = {
  tiles,
  mapWidthTiles: MAP_WIDTH,
  mapHeightTiles: MAP_HEIGHT,
  chunkSizeTiles: CHUNK_SIZE,
  tileSizePx: TILE_SIZE,
};

const chunkMap = buildTilemapPhysicsChunks(tilemapInput);

// Total chunks in the map
const CHUNKS_X = Math.ceil(MAP_WIDTH / CHUNK_SIZE); // 8
const CHUNKS_Y = Math.ceil(MAP_HEIGHT / CHUNK_SIZE); // 4

// Visibility windows (typical camera viewport = 3×3 chunks)
const VIEW_W = 3;
const VIEW_H = 3;

/** Build a chunk visibility array for a given top-left position. */
function makeVisibleChunks(offsetX: number, offsetY: number) {
  const result: Array<{ chunkX: number; chunkY: number }> = [];
  for (let y = offsetY; y < offsetY + VIEW_H && y < CHUNKS_Y; y++) {
    for (let x = offsetX; x < offsetX + VIEW_W && x < CHUNKS_X; x++) {
      result.push({ chunkX: x, chunkY: y });
    }
  }
  return result;
}

// Simulate camera positions across 8 frames (scroll right 1 chunk per frame)
const cameraPositions = Array.from({ length: 8 }, (_, i) => makeVisibleChunks(i, 0));

// Collision fixtures for the contact processing part of the loop
function makeEvents(count: number): CollisionEvent[] {
  const POOL = 32;
  return Array.from({ length: count }, (_, i) => ({
    aColliderId: i % POOL,
    bColliderId: (i * 5 + 1) % POOL,
    started: i % 2 === 0,
  }));
}

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

const EVENTS_PER_FRAME = makeEvents(80);
const BATCH_PER_FRAME = makeBatch(EVENTS_PER_FRAME);
const PLAYER_ENTITY: EntityId = createEntityId(0, 1);

// Patched tiles for chunk update simulation
const patchedTiles = [...tiles];
const PATCH_X = CHUNK_SIZE + 2;
const PATCH_Y = CHUNK_SIZE + 1;
patchedTiles[PATCH_Y * MAP_WIDTH + PATCH_X] ^= 1;

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

/**
 * Simulates 8 consecutive camera scroll frames.
 * Each frame: syncVisibleChunks(new visible set) — loads/unloads ~3 chunks.
 */
describe('integration — camera scroll (8 frames)', () => {
  bench('syncVisibleChunks — scroll right across 8 frames', () => {
    const physics = makeMockPhysics();
    const orch = createTilemapChunkOrchestrator(physics, {
      source: tilemapInput,
      initial: chunkMap,
    });
    for (const visible of cameraPositions) {
      orch.syncVisibleChunks(visible);
    }
  });
});

/**
 * Simulates a stable frame where the camera hasn't moved.
 * syncVisibleChunks should be a no-op (all chunks already loaded).
 */
describe('integration — stable frame (no-op)', () => {
  bench('syncVisibleChunks — same visible set (no-op)', () => {
    const physics = makeMockPhysics();
    const orch = createTilemapChunkOrchestrator(physics, {
      source: tilemapInput,
      initial: chunkMap,
    });
    const visible = makeVisibleChunks(0, 0);
    orch.syncVisibleChunks(visible); // initial load
    for (let i = 0; i < 8; i++) {
      orch.syncVisibleChunks(visible); // no-op frames
    }
  });
});

/**
 * Simulates a destructible tile edit: patchChunk rebakes one chunk
 * and reloads it via the physics API.
 */
describe('integration — destructible tile patch', () => {
  bench('patchChunk (1 chunk rebake + reload)', () => {
    const physics = makeMockPhysics();
    const orch = createTilemapChunkOrchestrator(physics, {
      source: tilemapInput,
      initial: chunkMap,
    });
    // Load the chunk first so patchChunk triggers a reload
    orch.syncVisibleChunks([{ chunkX: 1, chunkY: 1 }]);
    orch.patchChunk(1, 1, { ...tilemapInput, tiles: patchedTiles });
  });
});

/**
 * Full game-loop integration: each iteration simulates one frame of
 * a platformer: scroll check + contact deduplication + player contact lookup.
 */
describe('integration — full game loop (1 frame)', () => {
  // Create orchestrator once outside the bench
  const physics = makeMockPhysics();
  const orch = createTilemapChunkOrchestrator(physics, {
    source: tilemapInput,
    initial: chunkMap,
  });

  bench('1 frame: syncVisibleChunks + dedupeContacts + selectPlayerContacts', () => {
    // 1. Chunk visibility sync (stable — no-op after first load)
    orch.syncVisibleChunks(cameraPositions[0]!);

    // 2. Process collision events
    const deduped = dedupeContactsByPair(EVENTS_PER_FRAME);

    // 3. Player contact lookup
    selectContactsForEntityId(BATCH_PER_FRAME, PLAYER_ENTITY);

    // Prevent dead-code elimination
    if (deduped.length < 0) throw new Error('unreachable');
  });
});

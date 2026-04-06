/**
 * @module tilemap.bench
 * Vitest benchmark suite for tilemap physics chunk building and patching.
 *
 * Measures the performance of:
 * - `buildTilemapPhysicsChunks` — full build of a 256×128 tile map split into 16×16 chunks
 * - `patchTilemapPhysicsChunk` — incremental patch of a single chunk (chunk 3:2)
 *
 * Pre-computation is done OUTSIDE `bench()` calls to avoid polluting measurements
 * with setup overhead.
 */

import { describe, bench } from 'vitest';
import { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from '../src/index';
import { makeTiles } from './fixtures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAP_WIDTH_TILES = 256;
const MAP_HEIGHT_TILES = 128;
const CHUNK_SIZE_TILES = 16;
const TILE_SIZE_PX = 16;

// ---------------------------------------------------------------------------
// Pre-computed fixtures (outside bench calls — zero-alloc hot path)
// ---------------------------------------------------------------------------

const tiles = makeTiles(MAP_WIDTH_TILES, MAP_HEIGHT_TILES);

// Pre-baked chunk map — used as the `previous` argument in the patch bench.
const baked = buildTilemapPhysicsChunks({
  tiles,
  mapWidthTiles: MAP_WIDTH_TILES,
  mapHeightTiles: MAP_HEIGHT_TILES,
  chunkSizeTiles: CHUNK_SIZE_TILES,
  tileSizePx: TILE_SIZE_PX,
});

// Patch tiles: toggle one tile inside chunk (3,2).
const patchedTiles = [...tiles];
const PATCH_X = 3 * CHUNK_SIZE_TILES + 2;
const PATCH_Y = 2 * CHUNK_SIZE_TILES + 1;
const PATCH_IDX = PATCH_Y * MAP_WIDTH_TILES + PATCH_X;
patchedTiles[PATCH_IDX] = patchedTiles[PATCH_IDX] === 0 ? 1 : 0;

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

/**
 * Tilemap physics benchmark suite.
 *
 * Covers full-build and incremental-patch scenarios on a 256×128 tile map
 * with 16×16 tile chunks.
 */
describe('tilemap physics', () => {
  bench('buildTilemapPhysicsChunks 256×128', () => {
    buildTilemapPhysicsChunks({
      tiles,
      mapWidthTiles: MAP_WIDTH_TILES,
      mapHeightTiles: MAP_HEIGHT_TILES,
      chunkSizeTiles: CHUNK_SIZE_TILES,
      tileSizePx: TILE_SIZE_PX,
    });
  });

  bench('patchTilemapPhysicsChunk chunk 3:2', () => {
    patchTilemapPhysicsChunk({
      source: {
        tiles: patchedTiles,
        mapWidthTiles: MAP_WIDTH_TILES,
        mapHeightTiles: MAP_HEIGHT_TILES,
        chunkSizeTiles: CHUNK_SIZE_TILES,
        tileSizePx: TILE_SIZE_PX,
      },
      chunkX: 3,
      chunkY: 2,
      previous: baked,
    });
  });
});

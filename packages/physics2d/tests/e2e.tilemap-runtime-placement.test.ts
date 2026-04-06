/**
 * E2E-like runtime placement contract for tilemap chunks.
 *
 * This test stays inside the plugin library and validates the public helper flow:
 * bake chunks -> stream visible chunks -> patch one chunk.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildTilemapPhysicsChunks } from '../src/helpers/tilemap';
import { createTilemapChunkOrchestrator } from '../src/helpers/orchestration';

describe('e2e tilemap runtime placement contract (library scoped)', () => {
  it('streams adjacent chunks at deterministic world offsets and patches in place', () => {
    // 4x2 tiles, chunk size 2 => two horizontal chunks on the same row.
    const source = {
      tiles: [1, 1, 1, 1, 1, 1, 1, 1],
      mapWidthTiles: 4,
      mapHeightTiles: 2,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    };

    const baked = buildTilemapPhysicsChunks(source);

    const physics = {
      loadTilemapPhysicsChunk: vi.fn(),
      unloadTilemapPhysicsChunk: vi.fn(),
      patchTilemapPhysicsChunk: vi.fn(),
    };

    const orchestrator = createTilemapChunkOrchestrator(physics as any, {
      source,
      initial: baked,
      origin: { x: 3, y: 4 },
    });

    // Load two adjacent chunks on the same row.
    orchestrator.syncVisibleChunks([
      { chunkX: 0, chunkY: 0 },
      { chunkX: 1, chunkY: 0 },
    ]);

    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledTimes(2);

    const chunkWorldSizeM = (source.chunkSizeTiles * source.tileSizePx) / 50; // 0.64m
    const first = physics.loadTilemapPhysicsChunk.mock.calls[0];
    const second = physics.loadTilemapPhysicsChunk.mock.calls[1];

    // origin + chunk-grid offset
    expect(first[1]).toBeCloseTo(3, 6);
    expect(first[2]).toBeCloseTo(4, 6);

    expect(second[1]).toBeCloseTo(3 + chunkWorldSizeM, 6);
    expect(second[2]).toBeCloseTo(4, 6);

    // Patch loaded chunk 1:0 and verify placement stays deterministic.
    orchestrator.patchChunk(1, 0, {
      ...source,
      tiles: [1, 1, 1, 0, 1, 1, 1, 0],
    });

    expect(physics.patchTilemapPhysicsChunk).toHaveBeenCalledTimes(1);
    const patched = physics.patchTilemapPhysicsChunk.mock.calls[0];
    expect(patched[1]).toBeCloseTo(3 + chunkWorldSizeM, 6);
    expect(patched[2]).toBeCloseTo(4, 6);

    // Hide all visible chunks -> both are unloaded.
    orchestrator.syncVisibleChunks([]);
    expect(physics.unloadTilemapPhysicsChunk).toHaveBeenCalledTimes(2);
  });
});

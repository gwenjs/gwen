import { describe, expect, it, vi } from 'vitest';
import { createTilemapChunkOrchestrator } from '../src/helpers/orchestration';

describe('orchestration chunk world placement', () => {
  function makePhysics() {
    return {
      loadTilemapPhysicsChunk: vi.fn(),
      unloadTilemapPhysicsChunk: vi.fn(),
      patchTilemapPhysicsChunk: vi.fn(),
    } as const;
  }

  it('loads visible chunks at origin + chunk-grid offset in meters', () => {
    const physics = makePhysics();

    const source = {
      tiles: [1, 1, 1, 1],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 1,
      tileSizePx: 20,
    };

    const orchestrator = createTilemapChunkOrchestrator(physics as any, {
      source,
      origin: { x: 2, y: 3 },
    });

    orchestrator.syncVisibleChunks([
      { chunkX: 0, chunkY: 0 },
      { chunkX: 1, chunkY: 1 },
    ]);

    // chunkWorldSizeM = (chunkSizeTiles * tileSizePx) / 50 = (1 * 20) / 50 = 0.4
    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledTimes(2);

    const first = physics.loadTilemapPhysicsChunk.mock.calls[0];
    const second = physics.loadTilemapPhysicsChunk.mock.calls[1];

    expect(first[1]).toBeCloseTo(2.0, 6);
    expect(first[2]).toBeCloseTo(3.0, 6);

    expect(second[1]).toBeCloseTo(2.4, 6);
    expect(second[2]).toBeCloseTo(3.4, 6);
  });

  it('patches a loaded chunk at the same world offset formula', () => {
    const physics = makePhysics();

    const source = {
      tiles: [1, 0, 0, 0],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 1,
      tileSizePx: 30,
    };

    const orchestrator = createTilemapChunkOrchestrator(physics as any, {
      source,
      origin: { x: 1, y: 1.5 },
    });

    orchestrator.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);

    orchestrator.patchChunk(0, 0, {
      ...source,
      tiles: [1, 1, 0, 0],
    });

    // chunkWorldSizeM = (1 * 30) / 50 = 0.6
    expect(physics.patchTilemapPhysicsChunk).toHaveBeenCalledTimes(1);

    const patched = physics.patchTilemapPhysicsChunk.mock.calls[0];
    expect(patched[1]).toBeCloseTo(1.0, 6);
    expect(patched[2]).toBeCloseTo(1.5, 6);
  });
});

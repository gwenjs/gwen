import { describe, expect, it, vi } from 'vitest';
import { createTilemapChunkOrchestrator } from '../src/helpers/orchestration';

describe('orchestration helpers', () => {
  const source = {
    tiles: [1, 0, 0, 1],
    mapWidthTiles: 2,
    mapHeightTiles: 2,
    chunkSizeTiles: 1,
    tileSizePx: 16,
  };

  function makePhysics() {
    return {
      loadTilemapPhysicsChunk: vi.fn(),
      unloadTilemapPhysicsChunk: vi.fn(),
      patchTilemapPhysicsChunk: vi.fn(),
    } as any;
  }

  it('should load a newly visible chunk once', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);
    orch.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);

    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledTimes(1);
  });

  it('should unload chunks that are no longer visible', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);
    orch.syncVisibleChunks([]);

    expect(physics.unloadTilemapPhysicsChunk).toHaveBeenCalledTimes(1);
  });

  it('should not call unload when nothing was previously loaded', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([]);

    expect(physics.unloadTilemapPhysicsChunk).not.toHaveBeenCalled();
  });

  it('should silently skip a chunk that does not exist in the bake', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([{ chunkX: 99, chunkY: 99 }]);

    expect(physics.loadTilemapPhysicsChunk).not.toHaveBeenCalled();
  });

  it('should patch one chunk without full reload', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);
    orch.patchChunk(0, 0, { ...source, tiles: [1, 1, 0, 1] });

    expect(physics.patchTilemapPhysicsChunk).toHaveBeenCalledTimes(1);
    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledTimes(1);
  });

  it('should not call patchTilemapPhysicsChunk for a chunk that is not loaded', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    // chunk 0:0 exists in the bake but was never synced as visible
    orch.patchChunk(0, 0, { ...source, tiles: [1, 1, 0, 1] });

    expect(physics.patchTilemapPhysicsChunk).not.toHaveBeenCalled();
  });

  it('should unload all tracked chunks on dispose', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, { source });

    orch.syncVisibleChunks([
      { chunkX: 0, chunkY: 0 },
      { chunkX: 1, chunkY: 1 },
    ]);
    orch.dispose();

    expect(physics.unloadTilemapPhysicsChunk).toHaveBeenCalledTimes(2);
  });

  it('should accept a custom world origin', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, {
      source,
      origin: { x: 10, y: 20 },
    });

    orch.syncVisibleChunks([{ chunkX: 0, chunkY: 0 }]);

    const [, x, y] = physics.loadTilemapPhysicsChunk.mock.calls[0];
    expect(x).toBe(10);
    expect(y).toBe(20);
  });

  it('should place each visible chunk at its chunk-grid world offset', () => {
    const physics = makePhysics();
    const orch = createTilemapChunkOrchestrator(physics, {
      source,
      origin: { x: 1, y: 2 },
    });

    orch.syncVisibleChunks([{ chunkX: 1, chunkY: 1 }]);

    const [, x, y] = physics.loadTilemapPhysicsChunk.mock.calls[0];
    // source: chunkSizeTiles=1, tileSizePx=16 => chunk world size = 16 / 50 = 0.32m
    expect(x).toBeCloseTo(1.32, 6);
    expect(y).toBeCloseTo(2.32, 6);
  });
});

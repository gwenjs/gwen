import { describe, expect, it, vi } from 'vitest';
import { buildTilemapPhysicsChunks } from '../src/helpers/tilemap';
import { buildStaticGeometryChunk, loadStaticGeometryChunk } from '../src/helpers/static-geometry';

describe('static geometry helpers', () => {
  it('should merge contiguous solids into a single rectangle', () => {
    const map = buildStaticGeometryChunk({
      tiles: [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      mapWidthTiles: 4,
      mapHeightTiles: 4,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });

    const chunk = map.chunks.find((c) => c.chunkX === 0 && c.chunkY === 0);
    expect(chunk?.rects).toEqual([{ x: 0, y: 0, w: 2, h: 2 }]);
  });

  it('should produce no rects for an empty chunk', () => {
    const map = buildStaticGeometryChunk({
      tiles: [0, 0, 0, 0],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });

    expect(map.chunks[0].rects).toHaveLength(0);
  });

  it('should produce deterministic chunk checksums', () => {
    const input = {
      tiles: [1, 0, 0, 0],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    };
    const a = buildStaticGeometryChunk(input);
    const b = buildStaticGeometryChunk(input);
    expect(a.chunks[0].checksum).toBe(b.chunks[0].checksum);
  });

  it('should produce different checksums for different tile layouts', () => {
    const base = buildStaticGeometryChunk({
      tiles: [1, 0, 0, 0],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });
    const other = buildStaticGeometryChunk({
      tiles: [0, 0, 0, 1],
      mapWidthTiles: 2,
      mapHeightTiles: 2,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });
    expect(base.chunks[0].checksum).not.toBe(other.chunks[0].checksum);
  });

  it('should load chunk at given origin and return the chunk key', () => {
    const physics = { loadTilemapPhysicsChunk: vi.fn() } as any;
    const chunk = buildTilemapPhysicsChunks({
      tiles: [1],
      mapWidthTiles: 1,
      mapHeightTiles: 1,
      chunkSizeTiles: 1,
      tileSizePx: 16,
    }).chunks[0];

    const key = loadStaticGeometryChunk(physics, chunk, { x: 3, y: 4 });

    expect(key).toBe(chunk.key);
    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledWith(chunk, 3, 4);
  });

  it('should call loadTilemapPhysicsChunk with origin zero when not specified', () => {
    const physics = { loadTilemapPhysicsChunk: vi.fn() } as any;
    const chunk = buildTilemapPhysicsChunks({
      tiles: [1],
      mapWidthTiles: 1,
      mapHeightTiles: 1,
      chunkSizeTiles: 1,
      tileSizePx: 16,
    }).chunks[0];

    loadStaticGeometryChunk(physics, chunk, { x: 0, y: 0 });
    expect(physics.loadTilemapPhysicsChunk).toHaveBeenCalledWith(chunk, 0, 0);
  });
});

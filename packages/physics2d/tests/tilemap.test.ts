import { describe, expect, it } from 'vitest';
import { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from '../src/helpers/tilemap';
import { TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION } from '../src/types';

describe('buildTilemapPhysicsChunks', () => {
  it('bakes deterministic chunks with versioned format + checksum', () => {
    // 4x4 map, 2x2 chunks, one 2x2 solid block in top-left quadrant.
    const tiles = [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    const a = buildTilemapPhysicsChunks({
      tiles,
      mapWidthTiles: 4,
      mapHeightTiles: 4,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });
    const b = buildTilemapPhysicsChunks({
      tiles,
      mapWidthTiles: 4,
      mapHeightTiles: 4,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });

    expect(a.formatVersion).toBe(TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION);
    expect(a).toEqual(b);

    const chunk00 = a.chunks.find((c) => c.chunkX === 0 && c.chunkY === 0);
    expect(chunk00).toBeDefined();
    expect(chunk00!.rects).toHaveLength(1);
    expect(chunk00!.rects[0]).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(chunk00!.colliders[0]).toEqual(
      expect.objectContaining({ shape: 'box', hw: 16, hh: 16, offsetX: 16, offsetY: 16 }),
    );
  });

  it('patches only one chunk and updates checksum deterministically', () => {
    const baseTiles = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const full = buildTilemapPhysicsChunks({
      tiles: baseTiles,
      mapWidthTiles: 4,
      mapHeightTiles: 4,
      chunkSizeTiles: 2,
      tileSizePx: 16,
    });

    const patchedTiles = [...baseTiles];
    patchedTiles[0] = 1;

    const patched = patchTilemapPhysicsChunk({
      source: {
        tiles: patchedTiles,
        mapWidthTiles: 4,
        mapHeightTiles: 4,
        chunkSizeTiles: 2,
        tileSizePx: 16,
      },
      chunkX: 0,
      chunkY: 0,
      previous: full,
    });

    const old00 = full.chunks.find((c) => c.chunkX === 0 && c.chunkY === 0)!;
    const new00 = patched.chunks.find((c) => c.chunkX === 0 && c.chunkY === 0)!;
    expect(new00.checksum).not.toBe(old00.checksum);
    expect(new00.rects).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);

    // Neighbor chunk remains unchanged.
    const old10 = full.chunks.find((c) => c.chunkX === 1 && c.chunkY === 0)!;
    const new10 = patched.chunks.find((c) => c.chunkX === 1 && c.chunkY === 0)!;
    expect(new10).toEqual(old10);
  });
});

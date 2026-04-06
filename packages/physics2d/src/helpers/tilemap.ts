import type {
  BuildTilemapPhysicsChunksInput,
  PatchTilemapPhysicsChunkInput,
  PhysicsColliderDef,
  TilemapChunkRect,
  TilemapPhysicsChunk,
  TilemapPhysicsChunkMap,
} from '../types';
import { TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION } from '../types';

const DEFAULT_CHUNK_SIZE_TILES = 16;
const DEFAULT_TILE_SIZE_PX = 16;

function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function makeColliderFromRect(
  rect: TilemapChunkRect,
  tileSizePx: number,
  index: number,
): PhysicsColliderDef {
  return {
    id: `chunk_rect_${index}`,
    shape: 'box',
    hw: (rect.w * tileSizePx) / 2,
    hh: (rect.h * tileSizePx) / 2,
    offsetX: (rect.x + rect.w / 2) * tileSizePx,
    offsetY: (rect.y + rect.h / 2) * tileSizePx,
    groundedRole: 'none',
  };
}

function rectSignature(rects: readonly TilemapChunkRect[]): string {
  return rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join('|');
}

function bakeChunkRects(
  input: BuildTilemapPhysicsChunksInput,
  chunkX: number,
  chunkY: number,
  chunkSizeTiles: number,
): TilemapChunkRect[] {
  const { tiles, mapWidthTiles, mapHeightTiles, isSolidTile } = input;
  const originX = chunkX * chunkSizeTiles;
  const originY = chunkY * chunkSizeTiles;
  const maxX = Math.min(originX + chunkSizeTiles, mapWidthTiles);
  const maxY = Math.min(originY + chunkSizeTiles, mapHeightTiles);

  const defaultIsSolid = (tileValue: number) => tileValue !== 0;
  const solid = (tileValue: number, x: number, y: number) =>
    isSolidTile ? isSolidTile(tileValue, x, y) : defaultIsSolid(tileValue);

  const rowRuns: Array<Array<{ x0: number; x1: number }>> = [];
  for (let y = originY; y < maxY; y++) {
    const runs: Array<{ x0: number; x1: number }> = [];
    let x = originX;
    while (x < maxX) {
      const tile = tiles[y * mapWidthTiles + x] ?? 0;
      if (!solid(tile, x, y)) {
        x++;
        continue;
      }
      const x0 = x;
      x++;
      while (x < maxX) {
        const t = tiles[y * mapWidthTiles + x] ?? 0;
        if (!solid(t, x, y)) break;
        x++;
      }
      runs.push({ x0: x0 - originX, x1: x - originX });
    }
    rowRuns.push(runs);
  }

  const rects: TilemapChunkRect[] = [];
  const active = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();

  for (let row = 0; row < rowRuns.length; row++) {
    const runs = rowRuns[row];
    if (!runs) continue;
    const nextActive = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();

    for (const run of runs) {
      const key = `${run.x0}:${run.x1}`;
      const prev = active.get(key);
      if (prev) {
        nextActive.set(key, { ...prev, y1: row + 1 });
      } else {
        nextActive.set(key, { x0: run.x0, x1: run.x1, y0: row, y1: row + 1 });
      }
    }

    for (const [key, r] of active) {
      if (!nextActive.has(key)) {
        rects.push({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
      }
    }

    active.clear();
    for (const [key, r] of nextActive) active.set(key, r);
  }

  for (const r of active.values()) {
    rects.push({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
  }

  rects.sort((a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h);
  return rects;
}

function bakeChunk(
  input: BuildTilemapPhysicsChunksInput,
  chunkX: number,
  chunkY: number,
  chunkSizeTiles: number,
  tileSizePx: number,
): TilemapPhysicsChunk {
  const rects = bakeChunkRects(input, chunkX, chunkY, chunkSizeTiles);
  const checksum = fnv1a32(rectSignature(rects));
  const colliders = rects.map((r, i) => makeColliderFromRect(r, tileSizePx, i));
  return {
    key: chunkKey(chunkX, chunkY),
    chunkX,
    chunkY,
    checksum,
    rects,
    colliders,
  };
}

export function buildTilemapPhysicsChunks(
  input: BuildTilemapPhysicsChunksInput,
): TilemapPhysicsChunkMap {
  const chunkSizeTiles = input.chunkSizeTiles ?? DEFAULT_CHUNK_SIZE_TILES;
  const tileSizePx = input.tileSizePx ?? DEFAULT_TILE_SIZE_PX;
  const chunksX = Math.ceil(input.mapWidthTiles / chunkSizeTiles);
  const chunksY = Math.ceil(input.mapHeightTiles / chunkSizeTiles);

  const chunks: TilemapPhysicsChunk[] = [];
  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      chunks.push(bakeChunk(input, cx, cy, chunkSizeTiles, tileSizePx));
    }
  }

  return {
    formatVersion: TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION,
    mapWidthTiles: input.mapWidthTiles,
    mapHeightTiles: input.mapHeightTiles,
    chunkSizeTiles,
    tileSizePx,
    chunks,
  };
}

export function patchTilemapPhysicsChunk(
  input: PatchTilemapPhysicsChunkInput,
): TilemapPhysicsChunkMap {
  const chunkSizeTiles = input.source.chunkSizeTiles ?? input.previous.chunkSizeTiles;
  const tileSizePx = input.source.tileSizePx ?? input.previous.tileSizePx;
  const patched = bakeChunk(input.source, input.chunkX, input.chunkY, chunkSizeTiles, tileSizePx);

  const chunks = input.previous.chunks
    .filter((c) => !(c.chunkX === input.chunkX && c.chunkY === input.chunkY))
    .concat(patched)
    .sort((a, b) => a.chunkY - b.chunkY || a.chunkX - b.chunkX);

  return {
    ...input.previous,
    formatVersion: TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION,
    chunkSizeTiles,
    tileSizePx,
    chunks,
  };
}

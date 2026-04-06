import type {
  BuildTilemapPhysicsChunksInput,
  Physics2DAPI,
  TilemapPhysicsChunk,
  TilemapPhysicsChunkMap,
} from '../types';
import { buildTilemapPhysicsChunks } from './tilemap';

/**
 * Build merged static geometry chunks from a tilemap source.
 *
 * Delegates to `buildTilemapPhysicsChunks` and returns the resulting chunk map.
 * Adjacent solid tiles are merged via greedy rectangle packing, reducing the
 * total collider count and eliminating internal-edge ghost collision artefacts.
 *
 * @param input - Tilemap bake source (tiles array, dimensions, tile size).
 * @returns A versioned {@link TilemapPhysicsChunkMap} with merged colliders per chunk.
 *
 * @example
 * ```ts
 * const map = buildStaticGeometryChunk({ tiles, mapWidthTiles: 32, mapHeightTiles: 16, tileSizePx: 16 });
 * ```
 *
 * Units: all sizes in pixels; `loadStaticGeometryChunk` converts to meters at load time.
 */
export function buildStaticGeometryChunk(
  input: BuildTilemapPhysicsChunksInput,
): TilemapPhysicsChunkMap {
  return buildTilemapPhysicsChunks(input);
}

/**
 * Load one baked static geometry chunk into the physics world at a given world origin.
 *
 * Wraps `physics.loadTilemapPhysicsChunk` and returns the stable chunk key so callers
 * can track loaded chunks without storing the chunk object.
 *
 * @param physics - Physics2D service instance.
 * @param chunk - Baked chunk produced by {@link buildStaticGeometryChunk}.
 * @param origin - World origin of the chunk in **meters**.
 * @returns The stable chunk key (e.g. `"0:0"`) for use with `unloadTilemapPhysicsChunk`.
 *
 * @example
 * ```ts
 * const key = loadStaticGeometryChunk(physics, chunk, { x: 0, y: 0 });
 * // later: physics.unloadTilemapPhysicsChunk(key);
 * ```
 */
export function loadStaticGeometryChunk(
  physics: Physics2DAPI,
  chunk: TilemapPhysicsChunk,
  origin: { x: number; y: number },
): string {
  physics.loadTilemapPhysicsChunk(chunk, origin.x, origin.y);
  return chunk.key;
}

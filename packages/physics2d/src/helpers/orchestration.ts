import type {
  BuildTilemapPhysicsChunksInput,
  Physics2DAPI,
  TilemapChunkOrchestrator,
  TilemapPhysicsChunk,
  TilemapPhysicsChunkMap,
} from '../types';
import { buildTilemapPhysicsChunks, patchTilemapPhysicsChunk } from './tilemap';

const DEFAULT_PIXELS_PER_METER = 50;

function chunkIndexKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`;
}

function getChunk(
  map: TilemapPhysicsChunkMap,
  chunkX: number,
  chunkY: number,
): TilemapPhysicsChunk | undefined {
  return map.chunks.find((c) => c.chunkX === chunkX && c.chunkY === chunkY);
}

/**
 * Create a stateful orchestrator that keeps physics tilemap chunks in sync with a
 * camera-driven visibility set.
 *
 * The orchestrator tracks which chunks are currently loaded and performs the minimum
 * diff on each `syncVisibleChunks` call: it loads newly visible chunks once and
 * unloads chunks that are no longer visible. Calling `syncVisibleChunks` multiple
 * times with the same set is a safe no-op.
 *
 * Chunk colliders are chunk-local, so runtime loading applies the chunk-grid offset
 * (`chunkX/chunkY * chunkWorldSizeMeters`) on top of the provided `origin`.
 *
 * **Lifecycle:**
 * 1. Create once per scene (or per tilemap layer).
 * 2. Call `syncVisibleChunks` every frame or on camera move.
 * 3. Call `patchChunk` for runtime terrain edits.
 * 4. Call `dispose` on scene teardown to unload all tracked chunks.
 *
 * @param physics - Physics2D service instance.
 * @param options.source - Tilemap bake input used to build the initial chunk map.
 * @param options.initial - Pre-built chunk map. If omitted, baked from `source`.
 * @param options.origin - World origin of the entire tilemap in meters. Default `{ x: 0, y: 0 }`.
 * @returns A {@link TilemapChunkOrchestrator} with `syncVisibleChunks`, `patchChunk`, and `dispose`.
 *
 * @example
 * ```ts
 * const orch = createTilemapChunkOrchestrator(physics, { source: tilemapInput });
 *
 * // Each frame, derive visible chunks from camera bounds:
 * orch.syncVisibleChunks(getVisibleChunks(camera));
 *
 * // On destructible tile change:
 * orch.patchChunk(cx, cy, updatedTilemapInput);
 *
 * // On scene unload:
 * orch.dispose();
 * ```
 */
export function createTilemapChunkOrchestrator(
  physics: Physics2DAPI,
  options: {
    source: BuildTilemapPhysicsChunksInput;
    initial?: TilemapPhysicsChunkMap;
    origin?: { x: number; y: number };
  },
): TilemapChunkOrchestrator {
  let chunkMap = options.initial ?? buildTilemapPhysicsChunks(options.source);
  const origin = options.origin ?? { x: 0, y: 0 };
  const loaded = new Set<string>();

  function getChunkWorldSizeM(): number {
    return (chunkMap.chunkSizeTiles * chunkMap.tileSizePx) / DEFAULT_PIXELS_PER_METER;
  }

  return {
    syncVisibleChunks(chunks) {
      const nextVisible = new Set(chunks.map((c) => chunkIndexKey(c.chunkX, c.chunkY)));

      for (const key of loaded) {
        if (!nextVisible.has(key)) {
          physics.unloadTilemapPhysicsChunk(key);
          loaded.delete(key);
        }
      }

      for (const visible of chunks) {
        const key = chunkIndexKey(visible.chunkX, visible.chunkY);
        if (loaded.has(key)) continue;
        const chunk = getChunk(chunkMap, visible.chunkX, visible.chunkY);
        if (!chunk) continue;
        const chunkWorldSizeM = getChunkWorldSizeM();
        const worldX = origin.x + chunk.chunkX * chunkWorldSizeM;
        const worldY = origin.y + chunk.chunkY * chunkWorldSizeM;
        physics.loadTilemapPhysicsChunk(chunk, worldX, worldY);
        loaded.add(chunk.key);
      }
    },

    patchChunk(chunkX, chunkY, nextSource) {
      const previous = chunkMap;
      chunkMap = patchTilemapPhysicsChunk({
        source: nextSource,
        chunkX,
        chunkY,
        previous,
      });

      const next = getChunk(chunkMap, chunkX, chunkY);
      if (!next) return;
      if (!loaded.has(next.key)) return;
      const chunkWorldSizeM = getChunkWorldSizeM();
      const worldX = origin.x + next.chunkX * chunkWorldSizeM;
      const worldY = origin.y + next.chunkY * chunkWorldSizeM;
      physics.patchTilemapPhysicsChunk(next, worldX, worldY);
    },

    dispose() {
      for (const key of loaded) {
        physics.unloadTilemapPhysicsChunk(key);
      }
      loaded.clear();
    },
  };
}

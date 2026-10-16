import type { MemoryView } from "./engine-memory.js";
import type { GwenEngine } from "./engine-types.js";

/** Viewable lane kinds. Kinds 5, 6, and 7 stay out of the query table. */
export const LANE_VIEW = {
  0: Float32Array,
  1: Float64Array,
  2: Int32Array,
  3: Uint32Array,
  4: Uint8Array,
} as const;

export type ViewableLaneKind = keyof typeof LANE_VIEW;

export type LaneArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;

export interface ChunkLaneView {
  readonly chunkId: number;
  readonly count: number;
  readonly lanes: readonly LaneArray[];
}

const STAGING_BYTES = 512;
const STAGING_NAME = "core:component-staging";

interface CacheEntry {
  readonly buffer: ArrayBufferLike;
  readonly lanes: readonly LaneArray[];
}

const laneCaches = new WeakMap<GwenEngine, Map<string, CacheEntry>>();
const stagingViews = new WeakMap<GwenEngine, MemoryView<"dataview">>();

/** Number of lane-cache entries kept for this engine. */
export function chunkLaneCacheSize(engine: GwenEngine): number {
  return laneCaches.get(engine)?.size ?? 0;
}

function laneArray(
  kind: 0,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Float32Array;
function laneArray(
  kind: 1,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Float64Array;
function laneArray(
  kind: 2,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Int32Array;
function laneArray(
  kind: 3,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Uint32Array;
function laneArray(
  kind: 4,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): Uint8Array;
function laneArray(
  kind: ViewableLaneKind,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): LaneArray;
function laneArray(
  kind: ViewableLaneKind,
  buffer: ArrayBufferLike,
  byteOffset: number,
  length: number,
): LaneArray {
  switch (kind) {
    case 0:
      return new LANE_VIEW[0](buffer, byteOffset, length);
    case 1:
      return new LANE_VIEW[1](buffer, byteOffset, length);
    case 2:
      return new LANE_VIEW[2](buffer, byteOffset, length);
    case 3:
      return new LANE_VIEW[3](buffer, byteOffset, length);
    case 4:
      return new LANE_VIEW[4](buffer, byteOffset, length);
  }
}

function word(table: Uint32Array, index: number): number {
  return table[index] ?? 0;
}

function live(array: LaneArray, buffer: ArrayBufferLike): boolean {
  return array.buffer === buffer && array.buffer.byteLength !== 0;
}

/**
 * One DataView named `core:component-staging` over the engine staging buffer.
 * A later read returns the same view. After `memory.grow` the view rebuilds.
 */
export function componentStaging(engine: GwenEngine, readPtr: () => number): DataView {
  let view = stagingViews.get(engine);
  if (!view) {
    view = engine.memory.view({
      name: STAGING_NAME,
      type: "dataview",
      ptr: readPtr,
      length: () => STAGING_BYTES,
    });
    stagingViews.set(engine, view);
  }
  return view.array;
}

/**
 * Lane columns for one query table.
 * The cache key is chunk id, table generation, and `engine.memory.epoch`.
 * A detached buffer is rebuilt even when the epoch has not moved yet.
 */
export function chunkLaneViews(
  engine: GwenEngine,
  tablePtr: number,
  laneKinds: readonly ViewableLaneKind[],
): ChunkLaneView[] {
  const memory = engine.memory.linearMemory();
  if (memory === null || tablePtr <= 0) return [];
  const buffer = memory.buffer;
  const header = new Uint32Array(buffer, tablePtr, 4);
  const chunkCount = word(header, 0);
  const generation = word(header, 1);
  const stride = word(header, 2);
  const words = 4 + chunkCount * stride;
  const table = new Uint32Array(buffer, tablePtr, words);
  let cache = laneCaches.get(engine);
  if (!cache) {
    cache = new Map();
    laneCaches.set(engine, cache);
  }
  const views: ChunkLaneView[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const base = 4 + index * stride;
    const chunkId = word(table, base);
    const count = word(table, base + 1);
    const key = `${chunkId}:${generation}:${engine.memory.epoch}`;
    const cached = cache.get(key);
    if (
      cached !== undefined &&
      cached.lanes.length === laneKinds.length &&
      cached.lanes.every((lane) => live(lane, buffer))
    ) {
      views.push({ chunkId, count, lanes: cached.lanes });
      continue;
    }
    const lanes: LaneArray[] = [];
    for (let lane = 0; lane < laneKinds.length; lane += 1) {
      const kind = laneKinds[lane];
      if (kind === undefined) continue;
      lanes.push(laneArray(kind, buffer, word(table, base + 4 + lane), count));
    }
    const entry: CacheEntry = { buffer, lanes };
    cache.set(key, entry);
    views.push({ chunkId, count, lanes });
  }
  return views;
}

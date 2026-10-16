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
  generation: number;
  epoch: number;
  buffer: ArrayBufferLike;
  lanes: LaneArray[];
  stamp: number;
}

interface MutableChunkView {
  chunkId: number;
  count: number;
  lanes: LaneArray[];
}

interface LaneScratch {
  ptr: number;
  epoch: number;
  generation: number;
  buffer: ArrayBufferLike | null;
  table: Uint32Array | null;
  views: MutableChunkView[];
  cache: Map<number, CacheEntry>;
  stamp: number;
}

const laneScratch = new WeakMap<GwenEngine, LaneScratch>();
const stagingViews = new WeakMap<GwenEngine, MemoryView<"dataview">>();

/** Number of lane-cache entries kept for this engine. One per live chunk id. */
export function chunkLaneCacheSize(engine: GwenEngine): number {
  return laneScratch.get(engine)?.cache.size ?? 0;
}

function scratchFor(engine: GwenEngine): LaneScratch {
  let scratch = laneScratch.get(engine);
  if (scratch === undefined) {
    scratch = {
      ptr: 0,
      epoch: -1,
      generation: -1,
      buffer: null,
      table: null,
      views: [],
      cache: new Map(),
      stamp: 0,
    };
    laneScratch.set(engine, scratch);
  }
  return scratch;
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
 * One cache entry per chunk id. A repeat call with the same pointer, epoch,
 * and generation returns the same view array.
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
  const epoch = engine.memory.epoch;
  const scratch = scratchFor(engine);
  const cachedTable = scratch.table;
  if (
    cachedTable !== null &&
    scratch.buffer === buffer &&
    scratch.ptr === tablePtr &&
    scratch.epoch === epoch &&
    cachedTable[1] === scratch.generation
  ) {
    return scratch.views;
  }

  const header =
    cachedTable !== null &&
    cachedTable.buffer === buffer &&
    scratch.ptr === tablePtr &&
    cachedTable.length >= 4
      ? cachedTable
      : new Uint32Array(buffer, tablePtr, 4);
  const chunkCount = header[0] ?? 0;
  const generation = header[1] ?? 0;
  const stride = header[2] ?? 0;
  const words = 4 + chunkCount * stride;
  const table =
    header.length === words && header.byteOffset === tablePtr
      ? header
      : new Uint32Array(buffer, tablePtr, words);

  const stamp = scratch.stamp + 1;
  scratch.stamp = stamp;
  const cache = scratch.cache;
  const views = scratch.views;
  const kindCount = laneKinds.length;
  views.length = chunkCount;
  for (let index = 0; index < chunkCount; index += 1) {
    const base = 4 + index * stride;
    const chunkId = table[base] ?? 0;
    const count = table[base + 1] ?? 0;
    let entry = cache.get(chunkId);
    let reuse = entry !== undefined;
    if (
      reuse &&
      entry !== undefined &&
      (entry.generation !== generation ||
        entry.epoch !== epoch ||
        entry.buffer !== buffer ||
        entry.lanes.length !== kindCount)
    ) {
      reuse = false;
    }
    if (reuse && entry !== undefined) {
      const lanes = entry.lanes;
      for (let lane = 0; lane < kindCount; lane += 1) {
        const array = lanes[lane];
        if (array === undefined || array.buffer !== buffer || array.buffer.byteLength === 0) {
          reuse = false;
          break;
        }
      }
    }
    if (!reuse || entry === undefined) {
      const lanes: LaneArray[] = [];
      for (let lane = 0; lane < kindCount; lane += 1) {
        const kind = laneKinds[lane];
        if (kind === undefined) continue;
        lanes.push(laneArray(kind, buffer, table[base + 4 + lane] ?? 0, count));
      }
      entry = { generation, epoch, buffer, lanes, stamp };
      cache.set(chunkId, entry);
    } else {
      entry.stamp = stamp;
    }
    const view = views[index];
    if (view === undefined) {
      views[index] = { chunkId, count, lanes: entry.lanes };
    } else {
      view.chunkId = chunkId;
      view.count = count;
      view.lanes = entry.lanes;
    }
  }
  if (cache.size !== chunkCount) {
    for (const [id, entry] of cache) {
      if (entry.stamp !== stamp) cache.delete(id);
    }
  }
  scratch.ptr = tablePtr;
  scratch.epoch = epoch;
  scratch.generation = generation;
  scratch.buffer = buffer;
  scratch.table = table;
  return views;
}

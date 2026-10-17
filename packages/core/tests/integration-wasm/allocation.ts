/// <reference types="node" />

import v8 from "node:v8";
import vm from "node:vm";

/** Heap spaces that hold objects a path allocates. Code and trusted space are V8's own. */
const OBJECT_SPACES: readonly string[] = ["new_space", "new_large_object_space"];

const DEFAULT_REPEATS = 7;
const MIN_KEPT_WINDOWS = 3;

export interface AllocationReport {
  /**
   * Smallest `new_space` + `new_large_object_space` growth over the kept
   * windows, minus the instrument floor (`floorBytes`).
   */
  allocatedBytes: number;
  /** GCs inside the kept windows. A window with a GC is dropped, so this is 0. */
  gcCount: number;
  /**
   * Smallest `heapUsed` delta after a forced GC over the kept windows, minus
   * the same figure for an empty window.
   */
  retainedBytes: number;
  /** allocatedBytes / ops. */
  bytesPerOp: number;
  /** `allocatedBytes` of every kept window, before the floor. */
  windows: readonly number[];
  /** Windows dropped because a GC ran inside them. */
  droppedWindows: number;
  /**
   * Smallest growth of an empty window. The window's own calls
   * (`getHeapSpaceStatistics`, `memoryUsage`) allocate about 4 KB.
   */
  floorBytes: number;
}

export interface MeasureOptions {
  warmup: number;
  ops: number;
  /** Windows measured after the warm-up. Default 7. At least 3. */
  repeats?: number;
}

interface Window {
  allocated: number;
  retained: number;
  gcCount: number;
}

function collectGc(): () => void {
  const current = Reflect.get(globalThis, "gc");
  if (typeof current === "function") return () => Reflect.apply(current, undefined, []);
  v8.setFlagsFromString("--expose-gc");
  const exposed = Reflect.get(globalThis, "gc");
  if (typeof exposed === "function") return () => Reflect.apply(exposed, undefined, []);
  const fromVm: unknown = vm.runInNewContext("gc");
  if (typeof fromVm !== "function") {
    throw new Error("[GWEN] measureAllocations: no garbage collector is available");
  }
  return () => Reflect.apply(fromVm, undefined, []);
}

function objectSpacesUsed(): number {
  let total = 0;
  let seen = 0;
  for (const space of v8.getHeapSpaceStatistics()) {
    if (!OBJECT_SPACES.includes(space.space_name)) continue;
    total += space.space_used_size;
    seen += 1;
  }
  if (seen === 0) throw new Error("[GWEN] measureAllocations: new_space is missing");
  return total;
}

/** One forced GC, then one `run`, measured. The profiler is stopped in `finally`. */
async function measureWindow(gc: () => void, run: () => void | Promise<void>): Promise<Window> {
  gc();
  const spacesBefore = objectSpacesUsed();
  const heapBefore = process.memoryUsage().heapUsed;
  const profiler = new v8.GCProfiler();
  let profile: v8.GCProfilerResult | undefined;
  profiler.start();
  try {
    await run();
    const allocated = objectSpacesUsed() - spacesBefore;
    profile = profiler.stop();
    gc();
    return {
      allocated,
      retained: process.memoryUsage().heapUsed - heapBefore,
      gcCount: profile.statistics.length,
    };
  } finally {
    if (!profile) profiler.stop();
  }
}

function emptyRun(): void {}

function smallest(values: readonly number[]): number {
  let min = values[0] ?? 0;
  for (const value of values) if (value < min) min = value;
  return min;
}

/**
 * Bytes a path allocates per operation, measured over `repeats` windows.
 *
 * One window can be wrong in either direction: V8 allocates its own objects
 * (feedback, compiled code metadata) at times the test does not control, and
 * the calls that read the counters allocate too. A real per-operation
 * allocation shows in every window; a one-off shows in a few. The report uses
 * the smallest window, drops every window with a GC, and throws when fewer than
 * three are left. `measureFrameAllocations` in `bench/alloc/measure.ts` applies
 * the same rule to frames.
 *
 * Test-only. Promoting this helper is #57.
 */
export async function measureAllocations(
  run: () => void | Promise<void>,
  opts: MeasureOptions,
): Promise<AllocationReport> {
  if (opts.ops <= 0) throw new Error("[GWEN] measureAllocations: ops must be > 0");
  const repeats = opts.repeats ?? DEFAULT_REPEATS;
  if (!Number.isInteger(repeats) || repeats < MIN_KEPT_WINDOWS) {
    throw new Error(`[GWEN] measureAllocations: repeats must be an integer >= ${MIN_KEPT_WINDOWS}`);
  }
  const gc = collectGc();
  for (let i = 0; i < opts.warmup; i += 1) await run();

  const floors: Window[] = [];
  for (let i = 0; i < repeats; i += 1) floors.push(await measureWindow(gc, emptyRun));
  const floorAllocated = smallest(floors.map((window) => window.allocated));
  const floorRetained = smallest(floors.map((window) => window.retained));

  const kept: Window[] = [];
  const all: Window[] = [];
  for (let i = 0; i < repeats; i += 1) {
    const window = await measureWindow(gc, run);
    all.push(window);
    if (window.gcCount === 0) kept.push(window);
  }
  if (kept.length < MIN_KEPT_WINDOWS) {
    const seen = all.map((window) => `${window.allocated}/gc${window.gcCount}`).join(", ");
    throw new Error(
      `[GWEN] measureAllocations: unstable (GC in every window): ${kept.length} of ${repeats} windows had no GC (allocated/gc: ${seen})`,
    );
  }
  const windows = kept.map((window) => window.allocated);
  const allocatedBytes = Math.max(0, smallest(windows) - floorAllocated);
  const retainedBytes = Math.max(
    0,
    smallest(kept.map((window) => window.retained)) - floorRetained,
  );
  return {
    allocatedBytes,
    gcCount: 0,
    retainedBytes,
    bytesPerOp: allocatedBytes / opts.ops,
    windows,
    droppedWindows: repeats - kept.length,
    floorBytes: floorAllocated,
  };
}

/// <reference types="node" />

import v8 from "node:v8";
import vm from "node:vm";

export interface AllocationReport {
  /**
   * `new_space` bytes used after the run, minus the same counter after a
   * forced GC before the run. The second read is inside the window, so the
   * floor is a few KB. Code space and trusted space are not counted.
   */
  allocatedBytes: number;
  /** GCs observed during the run. Above zero, allocatedBytes is a lower bound. */
  gcCount: number;
  /** heapUsed after a forced GC following the run, minus the pre-run baseline. */
  retainedBytes: number;
  /** allocatedBytes / ops. */
  bytesPerOp: number;
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

function newSpaceUsed(): number {
  const found = v8.getHeapSpaceStatistics().find((space) => space.space_name === "new_space");
  if (found === undefined) throw new Error("[GWEN] measureAllocations: new_space is missing");
  return found.space_used_size;
}

/**
 * Count young-space bytes for one run. The profiler is stopped in `finally`.
 * Test-only. Promoting this helper is #57.
 */
export async function measureAllocations(
  run: () => void | Promise<void>,
  opts: { warmup: number; ops: number },
): Promise<AllocationReport> {
  if (opts.ops <= 0) throw new Error("[GWEN] measureAllocations: ops must be > 0");
  const gc = collectGc();
  for (let i = 0; i < opts.warmup; i += 1) await run();
  gc();
  const youngBefore = newSpaceUsed();
  const before = process.memoryUsage().heapUsed;
  const profiler = new v8.GCProfiler();
  let profile: v8.GCProfilerResult | undefined;
  profiler.start();
  try {
    await run();
    const allocatedBytes = newSpaceUsed() - youngBefore;
    profile = profiler.stop();
    gc();
    const retainedBytes = process.memoryUsage().heapUsed - before;
    return {
      allocatedBytes,
      gcCount: profile.statistics.length,
      retainedBytes,
      bytesPerOp: allocatedBytes / opts.ops,
    };
  } finally {
    if (!profile) profiler.stop();
  }
}

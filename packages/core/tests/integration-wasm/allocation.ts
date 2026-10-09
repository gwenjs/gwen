/// <reference types="node" />

import v8 from "node:v8";
import vm from "node:vm";

export interface AllocationReport {
  /** heapUsed after the run, minus heapUsed after a forced GC before the run. */
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

/**
 * Count heap bytes for one run. The profiler is stopped in `finally`.
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
  const before = process.memoryUsage().heapUsed;
  const profiler = new v8.GCProfiler();
  let profile: v8.GCProfilerResult | undefined;
  profiler.start();
  try {
    await run();
    const allocatedBytes = process.memoryUsage().heapUsed - before;
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

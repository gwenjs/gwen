/// <reference types="node" />

import { appendFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";

import { expect } from "vitest";

export interface AllocationReport {
  /**
   * `new_space` plus `new_large_object_space` (when that space exists) after
   * the run, minus the same sum after a forced GC before the run. The second
   * read is inside the window, so the floor is a few KB. Code space, trusted
   * space, and `old_space` are not counted.
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

function countedBytes(): number {
  const rows = v8.getHeapSpaceStatistics();
  const young = rows.find((space) => space.space_name === "new_space");
  if (young === undefined) throw new Error("[GWEN] measureAllocations: new_space is missing");
  const large = rows.find((space) => space.space_name === "new_large_object_space");
  return young.space_used_size + (large === undefined ? 0 : large.space_used_size);
}

function logAlloc(ops: number, allocatedBytes: number, gcCount: number): void {
  const file = process.env.GWEN_ALLOC_LOG;
  if (file === undefined || file.length === 0) return;
  const name = expect.getState().currentTestName ?? "unknown";
  const mode = __GWEN_DEV__ ? "dev" : "prod";
  const run = process.env.GWEN_ALLOC_RUN ?? "-";
  appendFileSync(
    file,
    `ALLOC run=${run} mode=${mode} test=${JSON.stringify(name)} bytesPerOp=${allocatedBytes / ops} gcCount=${gcCount}\n`,
  );
}

/**
 * Count young-generation bytes for one run. The profiler is stopped in `finally`.
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
  const youngBefore = countedBytes();
  const before = process.memoryUsage().heapUsed;
  const profiler = new v8.GCProfiler();
  let profile: v8.GCProfilerResult | undefined;
  profiler.start();
  try {
    await run();
    const allocatedBytes = countedBytes() - youngBefore;
    profile = profiler.stop();
    gc();
    const retainedBytes = process.memoryUsage().heapUsed - before;
    logAlloc(opts.ops, allocatedBytes, profile.statistics.length);
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
